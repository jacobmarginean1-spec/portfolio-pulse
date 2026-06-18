import { useState, useEffect, useRef } from "react";
import {
  Plus, X, RefreshCw, TrendingUp, Eye, ChevronUp, ChevronDown,
  GripVertical, Sun, Moon, Link, StickyNote, Layers, Wallet, Settings,
} from "lucide-react";

// Anthropic proxy endpoint (Vercel serverless function). See api/analyze.js.
const PROXY_URL = "/api/analyze";

const LS = {
  tickers: "pp-tickers", results: "pp-results", theme: "pp-theme",
  notes: "pp-notes", shares: "pp-shares", digest: "pp-digest",
  anthropicKey: "pp-anthropic-key", finnhubKey: "pp-finnhub-key",
};

const STALE_MS = 24 * 60 * 60 * 1000;

const KNOWN_SECTORS = {
  TSLA: "EV / Auto", BTC: "Crypto", AMD: "Semiconductors", AMZN: "Consumer / Tech",
  PLTR: "Software / Defense", FSLR: "Solar / Energy", SPCX: "Space / Aerospace",
  AAPL: "Consumer Tech", NVDA: "Semiconductors", MSFT: "Software / Tech",
  GOOG: "Tech / Ads", GOOGL: "Tech / Ads", META: "Social / Tech", ETH: "Crypto",
};

// Finnhub crypto symbol mapping
const CRYPTO_MAP = { BTC: "BINANCE:BTCUSDT", ETH: "BINANCE:ETHUSDT" };

function lsGet(key, fb) {
  try { const v = localStorage.getItem(key); return v == null ? fb : JSON.parse(v); }
  catch { return fb; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function sectorColor(sector, dark) {
  const d = dark;
  if (!sector) return d ? "text-stone-500 border-stone-600" : "text-stone-500 border-stone-300";
  const s = sector.toLowerCase();
  if (s.includes("crypto")) return d ? "text-orange-400 border-orange-700" : "text-orange-600 border-orange-300 bg-orange-50";
  if (s.includes("space") || s.includes("aero")) return d ? "text-indigo-400 border-indigo-700" : "text-indigo-600 border-indigo-300 bg-indigo-50";
  if (s.includes("semi") || s.includes("chip")) return d ? "text-sky-400 border-sky-700" : "text-sky-600 border-sky-300 bg-sky-50";
  if (s.includes("ev") || s.includes("auto")) return d ? "text-teal-400 border-teal-700" : "text-teal-600 border-teal-300 bg-teal-50";
  if (s.includes("solar") || s.includes("energy") || s.includes("oil")) return d ? "text-yellow-400 border-yellow-700" : "text-yellow-600 border-yellow-300 bg-yellow-50";
  if (s.includes("defense")) return d ? "text-red-400 border-red-700" : "text-red-500 border-red-300 bg-red-50";
  if (s.includes("etf") || s.includes("fund")) return d ? "text-violet-400 border-violet-700" : "text-violet-600 border-violet-300 bg-violet-50";
  if (s.includes("consumer") || s.includes("retail")) return d ? "text-pink-400 border-pink-700" : "text-pink-600 border-pink-300 bg-pink-50";
  if (s.includes("software") || s.includes("tech") || s.includes("ads") || s.includes("social")) return d ? "text-blue-400 border-blue-700" : "text-blue-600 border-blue-300 bg-blue-50";
  if (s.includes("bank") || s.includes("financ")) return d ? "text-emerald-400 border-emerald-700" : "text-emerald-600 border-emerald-300 bg-emerald-50";
  if (s.includes("health") || s.includes("pharma") || s.includes("bio")) return d ? "text-rose-400 border-rose-700" : "text-rose-600 border-rose-300 bg-rose-50";
  return d ? "text-stone-300 border-stone-600" : "text-stone-600 border-stone-300";
}

function fmtMoney(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function extractSources(content) {
  const sources = []; const seen = new Set();
  for (const block of content || []) {
    const items = block?.content;
    if (Array.isArray(items)) {
      for (const item of items) {
        const url = item?.url, title = item?.title;
        if (url && !seen.has(url)) { seen.add(url); sources.push({ url, title: title || url }); }
      }
    }
  }
  return sources.slice(0, 8);
}

export default function App() {
  const [tickers, setTickers] = useState(lsGet(LS.tickers, ["TSLA", "BTC", "AMD", "AMZN", "PLTR", "FSLR", "SPCX"]));
  const [input, setInput] = useState("");
  const [results, setResults] = useState(lsGet(LS.results, {}));
  const [loading, setLoading] = useState({});
  const [runningAll, setRunningAll] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [dragIdx, setDragIdx] = useState(null);
  const [dark, setDark] = useState(lsGet(LS.theme, "dark") === "dark");
  const [showSources, setShowSources] = useState({});
  const [notes, setNotes] = useState(lsGet(LS.notes, {}));
  const [editingNote, setEditingNote] = useState(null);
  const [shares, setShares] = useState(lsGet(LS.shares, {}));
  const [digest, setDigest] = useState(lsGet(LS.digest, null));
  const [digestLoading, setDigestLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [livePrices, setLivePrices] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState(lsGet(LS.anthropicKey, ""));
  const [finnhubKey, setFinnhubKey] = useState(lsGet(LS.finnhubKey, ""));
  const [akInput, setAkInput] = useState("");
  const [fkInput, setFkInput] = useState("");

  const resultsRef = useRef(results);
  const tickersRef = useRef(tickers);
  const cardRefs = useRef({});
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { tickersRef.current = tickers; }, [tickers]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!anthropicKey || !finnhubKey) { setShowSettings(true); }
    setAkInput(anthropicKey); setFkInput(finnhubKey);
  }, []); // eslint-disable-line

  // ---- live prices (Finnhub, direct browser calls OK) ----
  const fetchPrice = async (ticker, key = finnhubKey) => {
    if (!key) return;
    const symbol = CRYPTO_MAP[ticker] || ticker;
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`);
      const d = await r.json();
      if (typeof d.c === "number" && d.c > 0) {
        setLivePrices((p) => ({ ...p, [ticker]: { price: d.c, changePct: d.dp, at: d.t ? new Date(d.t * 1000).toLocaleTimeString() : null } }));
      }
    } catch {}
  };
  const fetchAllPrices = async (key = finnhubKey) => {
    for (const t of tickersRef.current) {
      await fetchPrice(t, key);
      await new Promise((r) => setTimeout(r, 1100));
    }
  };
  useEffect(() => { if (finnhubKey) fetchAllPrices(finnhubKey); }, [finnhubKey]); // eslint-disable-line

  // ---- persistence ----
  const saveTickers = (arr) => { setTickers(arr); tickersRef.current = arr; lsSet(LS.tickers, arr); };
  const persistResults = (r) => { setResults(r); resultsRef.current = r; lsSet(LS.results, r); };
  const saveNote = (t, text) => { const n = { ...notes }; if (text.trim()) n[t] = text.trim(); else delete n[t]; setNotes(n); lsSet(LS.notes, n); };
  const saveShares = (t, val) => { const s = { ...shares }; const num = parseFloat(val); if (!isNaN(num) && num > 0) s[t] = num; else delete s[t]; setShares(s); lsSet(LS.shares, s); };
  const toggleTheme = () => { const n = !dark; setDark(n); lsSet(LS.theme, n ? "dark" : "light"); };

  const addTicker = () => {
    const t = input.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (t && t.length <= 10 && !tickers.includes(t)) { saveTickers([...tickers, t]); fetchPrice(t); }
    setInput("");
  };
  const removeTicker = (t) => {
    saveTickers(tickers.filter((x) => x !== t));
    const r = { ...resultsRef.current }; delete r[t]; persistResults(r);
  };

  const handleDragStart = (e, i) => {
    e.preventDefault(); setDragIdx(i);
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const list = tickersRef.current; let target = null;
      for (let k = 0; k < list.length; k++) {
        const el = cardRefs.current[list[k]]; if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) { target = k; break; }
      }
      setDragIdx((cur) => {
        if (cur === null || target === null || target === cur) return cur;
        const arr = [...tickersRef.current];
        const [item] = arr.splice(cur, 1); arr.splice(target, 0, item);
        tickersRef.current = arr; setTickers(arr); return target;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up);
      setDragIdx(null); lsSet(LS.tickers, tickersRef.current);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
  };

  const callClaude = async (body) => {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error("Invalid Anthropic key — check Settings.");
      if (res.status === 429) throw new Error("Rate limited — wait and try again.");
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 160)}`);
    }
    return res.json();
  };

  const analyze = async (ticker) => {
    if (loading[ticker]) return;
    if (!anthropicKey) { setShowSettings(true); return; }
    setLoading((l) => ({ ...l, [ticker]: true }));
    fetchPrice(ticker);
    try {
      const data = await callClaude({
        model: "claude-sonnet-4-6",
        max_tokens: 1300,
        messages: [{
          role: "user",
          content: `Do TWO web searches max: (1) "${ticker} stock news price" and (2) "${ticker} stock reddit stocktwits sentiment" — then base your answer only on those results.

NEUTRALITY RULES for all fields except socialBuzz: use flat, factual language. No loaded verbs (soars, plunges, crushes, tanks). Separate fact from interpretation. Attribute every opinion to its source ("Barron's argues...", "some analysts cite..."). Never imply a recommendation. Present bull and bear cases with equal effort and specificity.

Respond ONLY with valid JSON (no markdown fences, no preamble):
{
  "ticker": "${ticker}",
  "sector": "short market category label, e.g. 'Semiconductors', 'EV / Auto', 'Crypto', 'Space / Aerospace', 'ETF'",
  "summary": "2-3 sentence factual summary of recent news. Facts only, no spin.",
  "bullCase": "1-2 sentences: the strongest argument for upside, attributed to its sources",
  "bearCase": "1-2 sentences: the strongest argument for downside, attributed to its sources",
  "watch": ["concrete thing to watch 1", "thing 2", "thing 3"],
  "catalysts": ["known upcoming dated events if any, e.g. 'Earnings: Jul 22' — empty array if none found"],
  "macroEvents": [{"event": "factual description of a significant real-world event (bill passing, shortage, tariff, regulation, geopolitical development)", "impact": "how it could affect this stock, clearly attributed: either 'Source X suggests...' or 'Speculation: ...'"}],
  "socialBuzz": "2-3 casual sentences capturing what retail traders on Reddit, StockTwits, X are actually saying and feeling — slang and mood included. Be true to the vibe, don't sanitize it."
}

macroEvents rules: ONLY include events significant enough to plausibly cause a drastic move. Empty array if nothing of that magnitude appears. Each "impact" labeled as sourced analysis or speculation.`,
        }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      });
      const textBlocks = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const clean = textBlocks.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response.");
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.fetchedAt = new Date().toLocaleString();
      parsed.fetchedAtMs = Date.now();
      parsed.sources = extractSources(data.content);
      persistResults({ ...resultsRef.current, [ticker]: parsed });
    } catch (e) {
      persistResults({ ...resultsRef.current, [ticker]: { ...(resultsRef.current[ticker] || {}), error: e.message } });
    } finally {
      setLoading((l) => ({ ...l, [ticker]: false }));
    }
  };

  const analyzeAll = async () => {
    if (runningAll) return;
    setRunningAll(true);
    for (const t of tickersRef.current) {
      await analyze(t);
      const r = resultsRef.current[t];
      if (r?.error && r.error.includes("Rate limited")) break;
      await new Promise((res) => setTimeout(res, 2000));
    }
    setRunningAll(false);
  };

  // ---- portfolio math (live prices) ----
  const priceOf = (t) => livePrices[t]?.price ?? null;
  const positions = tickers.map((t) => {
    const price = priceOf(t), qty = shares[t];
    return { ticker: t, price, qty, value: price && qty ? price * qty : null };
  });
  const valuedPositions = positions.filter((p) => p.value !== null);
  const totalValue = valuedPositions.reduce((s, p) => s + p.value, 0);

  const generateDigest = async () => {
    if (digestLoading) return;
    if (!anthropicKey) { setShowSettings(true); return; }
    const available = tickersRef.current.map((t) => {
      const r = resultsRef.current[t];
      if (!r || r.error || !r.summary) return null;
      const price = priceOf(t), qty = shares[t];
      const value = price && qty ? price * qty : null;
      return {
        ticker: t, sector: r.sector || KNOWN_SECTORS[t] || null, sharesOwned: qty || null,
        positionValue: value ? Math.round(value * 100) / 100 : null,
        weightPct: value && totalValue > 0 ? Math.round((value / totalValue) * 1000) / 10 : null,
        summary: r.summary, bullCase: r.bullCase, bearCase: r.bearCase,
        catalysts: r.catalysts, macroEvents: r.macroEvents,
      };
    }).filter(Boolean);
    if (available.length < 2) { setDigest({ error: "Analyze at least 2 tickers first." }); return; }
    setDigestLoading(true);
    try {
      const data = await callClaude({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `Here are per-ticker analyses from my portfolio, with position sizes/weights: ${JSON.stringify(available)}

Produce a cross-portfolio assessment. NEUTRALITY RULES: flat factual language, no loaded verbs, attribute opinions, never imply a buy/sell recommendation. Do NOT search — work only from the data above.

Respond ONLY with valid JSON (no markdown fences, no preamble):
{
  "portfolioOutlook": "2-3 sentences: balanced near-term outlook for the whole portfolio. Upside and downside with equal weight, framed as possibilities.",
  "sharedRisks": ["risk affecting 2+ holdings, naming which tickers"],
  "conflictingSignals": ["places where analyses point different directions, or empty array"],
  "keyCatalysts": ["most significant upcoming dated events across the portfolio, or empty array"],
  "composition": "1-2 sentence factual observation about concentration/exposure. Pure description, no advice.",
  "principles": ["3-4 items. Each: an established academic-finance concept relevant to THIS portfolio's composition, attributed to its source, stated educationally (e.g. Markowitz 1952 on diversification across uncorrelated assets, and how it maps to these holdings). NEVER say what to buy or sell."]
}`,
        }],
      });
      const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in digest.");
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.generatedAt = new Date().toLocaleString();
      setDigest(parsed); lsSet(LS.digest, parsed);
    } catch (e) {
      setDigest({ error: e.message });
    } finally {
      setDigestLoading(false);
    }
  };

  const allCollapsible = tickers.filter((t) => results[t] && !results[t].error);
  const allCollapsed = allCollapsible.length > 0 && allCollapsible.every((t) => collapsed[t]);
  const toggleCollapseAll = () => { const next = {}; allCollapsible.forEach((t) => (next[t] = !allCollapsed)); setCollapsed(next); };

  const T = dark ? THEME_DARK : THEME_LIGHT;

  return (
    <div className={`min-h-screen ${T.page} p-6 transition-colors pf-sans`}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between mb-1">
          <h1 className={`text-2xl font-bold ${T.title}`}>Portfolio Pulse</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowSettings(true)} className={`${T.smallBtn} rounded-sm p-2 transition-colors`} title="Settings / API keys"><Settings size={16} /></button>
            <button onClick={toggleTheme} className={`${T.smallBtn} rounded-sm p-2 transition-colors`} title={dark ? "Light mode" : "Dark mode"}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          </div>
        </div>
        <p className={`${T.sub} text-sm mb-6`}>Neutral, source-attributed news analysis with live prices. Educational, not financial advice.</p>

        {(!anthropicKey || !finnhubKey) && !showSettings && (
          <div className={`${T.macroBox} border-l-2 rounded-sm px-3 py-2 mb-4 text-sm flex items-center justify-between`}>
            <span className={T.body}>Add your API keys to start.</span>
            <button onClick={() => setShowSettings(true)} className={`${T.addBtn} rounded-sm px-3 py-1 text-xs font-medium`}>Open Settings</button>
          </div>
        )}

        <div className="flex gap-2 mb-3 flex-wrap">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTicker()} placeholder="Add ticker (e.g. TSLA)" className={`flex-1 min-w-[140px] ${T.input} border rounded-sm px-3 py-2 text-sm focus:outline-none pf-mono`} />
          <button onClick={addTicker} className={`${T.addBtn} rounded-sm px-4 py-2 flex items-center gap-1 text-sm font-medium transition-colors`}><Plus size={16} /> Add</button>
          <button onClick={analyzeAll} disabled={runningAll} className={`${T.allBtn} disabled:opacity-50 rounded-sm px-4 py-2 flex items-center gap-1 text-sm font-medium transition-colors`}><RefreshCw size={16} className={runningAll ? "animate-spin" : ""} />{runningAll ? "Running..." : "Analyze All"}</button>
          <button onClick={generateDigest} disabled={digestLoading} className={`${T.smallBtn} rounded-sm px-3 py-2 flex items-center gap-1 text-sm font-medium transition-colors disabled:opacity-50`} title="Cross-portfolio assessment (no searches)"><Layers size={16} className={digestLoading ? "animate-pulse" : ""} />{digestLoading ? "Working..." : "Digest"}</button>
          {allCollapsible.length > 0 && (
            <button onClick={toggleCollapseAll} className={`${T.smallBtn} rounded-sm px-3 py-2 flex items-center gap-1 text-sm font-medium transition-colors`}>{allCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}{allCollapsed ? "Expand" : "Collapse"}</button>
          )}
        </div>

        {valuedPositions.length > 0 && (
          <div className={`${T.valueBar} border rounded-sm px-4 py-3 mb-3 flex items-baseline gap-3 flex-wrap`}>
            <span className="flex items-center gap-1.5"><Wallet size={14} className={T.digestLabel} /><span className={`${T.label} text-xs uppercase tracking-wider`}>Portfolio Value</span></span>
            <span className={`text-xl font-bold ${T.priceText} pf-mono`}>{fmtMoney(totalValue)}</span>
            <span className={`text-xs ${T.meta}`}>{valuedPositions.length} of {tickers.length} positions · live prices</span>
          </div>
        )}

        {digest && (
          <div className={`${T.digestBox} border rounded-sm p-4 mb-6 text-sm`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`${T.digestLabel} text-xs uppercase tracking-wider font-semibold`}>Portfolio Assessment</span>
              <div className="flex items-center gap-2">
                {digest.generatedAt && <span className={`text-[10px] ${T.meta}`}>{digest.generatedAt}</span>}
                <button onClick={() => { setDigest(null); lsSet(LS.digest, null); }} className={T.grip}><X size={12} /></button>
              </div>
            </div>
            {digest.error ? <p className={T.error}>{digest.error}</p> : (
              <div className="space-y-3">
                {digest.portfolioOutlook && (<div><div className={`${T.label} text-xs uppercase tracking-wider mb-0.5`}>Overall Outlook</div><p className={T.body}>{digest.portfolioOutlook}</p></div>)}
                {digest.composition && (<div><div className={`${T.label} text-xs uppercase tracking-wider mb-0.5`}>Composition</div><p className={T.body}>{digest.composition}</p></div>)}
                {digest.sharedRisks?.length > 0 && (<div><div className={`${T.label} text-xs uppercase tracking-wider mb-0.5`}>Shared Risks</div><ul className={`list-disc list-inside ${T.body} space-y-0.5`}>{digest.sharedRisks.map((s, i) => <li key={i}>{s}</li>)}</ul></div>)}
                {digest.conflictingSignals?.length > 0 && (<div><div className={`${T.label} text-xs uppercase tracking-wider mb-0.5`}>Conflicting Signals</div><ul className={`list-disc list-inside ${T.body} space-y-0.5`}>{digest.conflictingSignals.map((s, i) => <li key={i}>{s}</li>)}</ul></div>)}
                {digest.keyCatalysts?.length > 0 && (<div><div className={`${T.label} text-xs uppercase tracking-wider mb-0.5`}>Key Catalysts</div><ul className={`list-disc list-inside ${T.body} space-y-0.5`}>{digest.keyCatalysts.map((s, i) => <li key={i}>{s}</li>)}</ul></div>)}
                {digest.principles?.length > 0 && (
                  <div className={`${T.catBox} border-l-2 rounded-sm px-3 py-2`}>
                    <div className={`${T.catLabel} text-xs uppercase tracking-wider mb-1`}>🎓 Portfolio Principles</div>
                    <ul className={`${T.bodyMuted} space-y-1.5 list-disc list-inside`}>{digest.principles.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    <p className={`${T.meta} text-[10px] mt-1.5`}>Educational concepts from academic finance applied to your holdings — not personalized advice.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {tickers.map((t, i) => {
            const r = results[t];
            const hasAnalysis = r && !r.error;
            const isCollapsed = collapsed[t];
            const sector = r?.sector || KNOWN_SECTORS[t];
            const sc = sectorColor(sector, dark);
            const isStale = hasAnalysis && r.fetchedAtMs && now - r.fetchedAtMs > STALE_MS;
            const note = notes[t];
            const qty = shares[t];
            const lp = livePrices[t];
            const price = lp?.price ?? null;
            const posValue = price && qty ? price * qty : null;
            const weight = posValue && totalValue > 0 ? (posValue / totalValue) * 100 : null;
            const changePct = lp?.changePct;
            return (
              <div key={t} ref={(el) => (cardRefs.current[t] = el)} className={`${T.card} border rounded-sm p-4 transition-shadow ${dragIdx === i ? T.cardDrag : ""}`}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span onPointerDown={(e) => handleDragStart(e, i)} className={`cursor-grab active:cursor-grabbing ${T.grip} touch-none flex-shrink-0`} title="Drag to reorder"><GripVertical size={16} /></span>
                    <span className={`text-lg font-semibold ${T.tickerText} pf-mono`}>{t}</span>
                    {sector && <span className={`text-[10px] uppercase tracking-wider border rounded-sm px-1.5 py-0.5 ${sc}`}>{sector}</span>}
                    {isStale && <span className={`text-[10px] uppercase tracking-wider border rounded-sm px-1.5 py-0.5 ${T.stale}`} title={`Last updated ${r.fetchedAt}`}>Stale</span>}
                    {r?.fetchedAt && !r.error && !isStale && <span className={`text-[10px] ${T.meta} truncate`}>upd {r.fetchedAt}</span>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 items-center">
                    <input type="number" min="0" step="any" placeholder="qty" defaultValue={qty || ""} onBlur={(e) => saveShares(t, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} className={`w-16 ${T.sharesInput} border rounded-sm px-2 py-1 text-xs focus:outline-none pf-mono`} title="Shares owned" />
                    <button onClick={() => setEditingNote(editingNote === t ? null : t)} className={`text-xs ${T.smallBtn} rounded-sm px-2 py-1.5 transition-colors ${note ? "ring-1 ring-amber-500/50" : ""}`} title="Your notes"><StickyNote size={12} /></button>
                    {hasAnalysis && <button onClick={() => setCollapsed((c) => ({ ...c, [t]: !c[t] }))} className={`text-xs ${T.smallBtn} rounded-sm px-2 py-1.5 transition-colors`} title={isCollapsed ? "Expand" : "Collapse"}>{isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}</button>}
                    <button onClick={() => analyze(t)} disabled={loading[t] || runningAll} className={`text-xs ${T.smallBtn} rounded-sm px-3 py-1.5 flex items-center gap-1 disabled:opacity-50 transition-colors`}><RefreshCw size={12} className={loading[t] ? "animate-spin" : ""} />{loading[t] ? "Analyzing..." : "Analyze"}</button>
                    <button onClick={() => removeTicker(t)} className={`text-xs ${T.delBtn} rounded-sm px-2 py-1.5 transition-colors`}><X size={12} /></button>
                  </div>
                </div>

                {editingNote === t && (
                  <textarea autoFocus defaultValue={note || ""} placeholder="Your thesis, entry price, reminders... (saved when you click away)" onBlur={(e) => { saveNote(t, e.target.value); setEditingNote(null); }} className={`w-full ${T.input} border rounded-sm px-3 py-2 text-sm focus:outline-none mb-2 min-h-[60px]`} />
                )}
                {note && editingNote !== t && (
                  <div className={`${T.noteBox} border rounded-sm px-3 py-1.5 mb-2 text-xs ${T.noteText} flex items-start gap-1.5`}><StickyNote size={11} className="mt-0.5 flex-shrink-0 opacity-60" /><span className="whitespace-pre-wrap">{note}</span></div>
                )}

                {/* live price line (always shown if available) */}
                {price !== null && (isCollapsed || !hasAnalysis) && (
                  <div className={`flex items-baseline gap-2 text-sm ${T.meta} flex-wrap pf-mono`}>
                    <span className={`font-semibold ${T.body}`}>{fmtMoney(price)}</span>
                    {typeof changePct === "number" && <span className={changePct < 0 ? T.down : T.up}>{changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%</span>}
                    {posValue !== null && <span className={T.meta}>· {qty} sh = <span className={T.body}>{fmtMoney(posValue)}</span>{weight !== null && ` (${weight.toFixed(1)}%)`}</span>}
                  </div>
                )}

                {hasAnalysis && !isCollapsed && (
                  <div className="space-y-3 text-sm">
                    {price !== null && (
                      <div className={`flex items-baseline gap-2 ${T.priceBox} rounded-sm px-3 py-2 border-l-2 flex-wrap pf-mono`}>
                        <span className={`text-xl font-bold ${T.priceText}`}>{fmtMoney(price)}</span>
                        {typeof changePct === "number" && <span className={`text-sm font-medium ${changePct < 0 ? T.down : T.up}`}>{changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%</span>}
                        {posValue !== null && <span className={`text-xs ${T.meta}`}>{qty} sh = <span className={`${T.body} font-medium`}>{fmtMoney(posValue)}</span>{weight !== null && ` · ${weight.toFixed(1)}% of portfolio`}</span>}
                        {lp?.at && <span className={`text-xs ${T.meta} ml-auto`}>{lp.at}</span>}
                      </div>
                    )}
                    <div><div className={`${T.label} text-xs uppercase tracking-wider mb-1`}>Recent News</div><p className={T.body}>{r.summary}</p></div>
                    {(r.bullCase || r.bearCase) && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className={`${T.bullBox} border-l-2 rounded-sm px-3 py-2`}><div className={`${T.bullLabel} text-xs uppercase tracking-wider mb-1`}>Bull Case</div><p className={T.bodyMuted}>{r.bullCase || "—"}</p></div>
                        <div className={`${T.bearBox} border-l-2 rounded-sm px-3 py-2`}><div className={`${T.bearLabel} text-xs uppercase tracking-wider mb-1`}>Bear Case</div><p className={T.bodyMuted}>{r.bearCase || "—"}</p></div>
                      </div>
                    )}
                    {r.catalysts?.length > 0 && (
                      <div className={`${T.catBox} border-l-2 rounded-sm px-3 py-2`}><div className={`${T.catLabel} text-xs uppercase tracking-wider mb-1`}>📅 Upcoming Catalysts</div><ul className={`${T.bodyMuted} space-y-0.5`}>{r.catalysts.map((c, idx) => <li key={idx}>{c}</li>)}</ul></div>
                    )}
                    <div className="flex items-start gap-2"><Eye size={14} className={`${T.watchIcon} mt-0.5 flex-shrink-0`} /><div><div className={`${T.label} text-xs uppercase tracking-wider mb-1`}>Watch For</div><ul className={`list-disc list-inside ${T.body} space-y-0.5`}>{r.watch?.map((w, idx) => <li key={idx}>{w}</li>)}</ul></div></div>
                    {r.macroEvents?.length > 0 && (
                      <div className={`${T.macroBox} border-l-2 rounded-sm px-3 py-2`}><div className={`${T.macroLabel} text-xs uppercase tracking-wider mb-1`}>🌍 Real-World Events</div><div className="space-y-2">{r.macroEvents.map((m, idx) => <div key={idx}><p className={T.body}>{m.event}</p><p className={`${T.macroSub} text-xs mt-0.5`}>{m.impact}</p></div>)}</div></div>
                    )}
                    {r.socialBuzz && (
                      <div className={`${T.buzzBox} border-l-2 rounded-sm px-3 py-2`}><div className={`${T.buzzLabel} text-xs uppercase tracking-wider mb-1`}>💬 Street Talk</div><p className={`${T.bodyMuted} italic`}>{r.socialBuzz}</p></div>
                    )}
                    {r.sources?.length > 0 && (
                      <div>
                        <button onClick={() => setShowSources((s) => ({ ...s, [t]: !s[t] }))} className={`flex items-center gap-1 text-xs ${T.label} hover:underline`}><Link size={11} />{showSources[t] ? "Hide sources" : `Sources (${r.sources.length})`}</button>
                        {showSources[t] && <ul className="mt-1 space-y-0.5 text-xs">{r.sources.map((s, idx) => <li key={idx} className="truncate"><a href={s.url} target="_blank" rel="noopener noreferrer" className={`${T.srcLink} underline`}>{s.title}</a></li>)}</ul>}
                      </div>
                    )}
                  </div>
                )}
                {r?.error && <p className={`${T.error} text-sm`}>{r.error}</p>}
                {!r && !loading[t] && price === null && <p className={`${T.empty} text-sm`}>No analysis yet — click Analyze.</p>}
              </div>
            );
          })}
          {tickers.length === 0 && <p className={`${T.empty} text-sm text-center py-8`}>Add a ticker to get started.</p>}
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => { if (anthropicKey && finnhubKey) setShowSettings(false); }}>
          <div className={`${T.card} border rounded-sm p-5 max-w-md w-full`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className={`text-lg font-bold ${T.title}`}>Settings</h2>
              <button onClick={() => { if (anthropicKey && finnhubKey) setShowSettings(false); }} className={T.grip}><X size={16} /></button>
            </div>
            <p className={`${T.sub} text-xs mb-4`}>Keys are stored only in your browser (localStorage) and sent directly to each service. Nothing is logged or shared.</p>
            <label className={`${T.label} text-xs uppercase tracking-wider`}>Anthropic API Key</label>
            <input type="password" value={akInput} onChange={(e) => setAkInput(e.target.value)} placeholder="sk-ant-..." className={`w-full ${T.input} border rounded-sm px-3 py-2 text-sm focus:outline-none mb-1 mt-1 pf-mono`} />
            <p className={`${T.meta} text-[10px] mb-3`}>Get one at console.anthropic.com → API Keys</p>
            <label className={`${T.label} text-xs uppercase tracking-wider`}>Finnhub API Key (free)</label>
            <input type="password" value={fkInput} onChange={(e) => setFkInput(e.target.value)} placeholder="your finnhub token" className={`w-full ${T.input} border rounded-sm px-3 py-2 text-sm focus:outline-none mb-1 mt-1 pf-mono`} />
            <p className={`${T.meta} text-[10px] mb-4`}>Free key at finnhub.io/register</p>
            <button onClick={() => { setAnthropicKey(akInput.trim()); setFinnhubKey(fkInput.trim()); lsSet(LS.anthropicKey, akInput.trim()); lsSet(LS.finnhubKey, fkInput.trim()); setShowSettings(false); }} disabled={!akInput.trim() || !fkInput.trim()} className={`${T.addBtn} disabled:opacity-50 rounded-sm px-4 py-2 text-sm font-medium w-full`}>Save Keys</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// THEMES
// ----------------------------------------------------------------------------
const THEME_DARK = {
  page: "bg-stone-950 text-stone-100", title: "text-amber-50", sub: "text-stone-400",
  input: "bg-stone-900 border-stone-700 focus:border-amber-600 text-stone-100",
  addBtn: "bg-amber-700 hover:bg-amber-600 text-white", allBtn: "bg-teal-700 hover:bg-teal-600 text-white",
  card: "bg-stone-900 border-stone-800", cardDrag: "border-amber-600 shadow-lg shadow-amber-900/20",
  tickerText: "text-amber-50", smallBtn: "bg-stone-800 hover:bg-stone-700 text-stone-200",
  delBtn: "bg-stone-800 hover:bg-red-900 text-stone-200", grip: "text-stone-600 hover:text-stone-400",
  meta: "text-stone-500", priceBox: "bg-stone-800/60 border-amber-600", priceText: "text-amber-50",
  up: "text-teal-400", down: "text-red-400", label: "text-stone-400", body: "text-stone-200", bodyMuted: "text-stone-300",
  bullBox: "bg-teal-950/40 border-teal-600", bullLabel: "text-teal-400", bearBox: "bg-red-950/30 border-red-700", bearLabel: "text-red-400",
  catBox: "bg-stone-800/60 border-sky-600", catLabel: "text-sky-400", macroBox: "bg-amber-950/30 border-amber-600", macroLabel: "text-amber-400", macroSub: "text-stone-400",
  buzzBox: "bg-violet-950/40 border-violet-600", buzzLabel: "text-violet-400", watchIcon: "text-amber-400",
  empty: "text-stone-500", error: "text-red-400", stale: "text-amber-500 border-amber-700 bg-amber-950/40",
  srcLink: "text-sky-400 hover:text-sky-300", noteBox: "bg-stone-800/40 border-stone-700", noteText: "text-stone-300",
  digestBox: "bg-stone-900 border-stone-700", digestLabel: "text-amber-400", valueBar: "bg-stone-900 border-stone-700",
  sharesInput: "bg-stone-800 border-stone-700 text-stone-200 focus:border-amber-600",
};
const THEME_LIGHT = {
  page: "bg-orange-50 text-stone-800", title: "text-stone-800", sub: "text-stone-500",
  input: "bg-white border-stone-300 focus:border-amber-400 text-stone-800",
  addBtn: "bg-amber-400 hover:bg-amber-500 text-stone-900", allBtn: "bg-teal-400 hover:bg-teal-500 text-stone-900",
  card: "bg-white border-stone-200 shadow-sm", cardDrag: "border-amber-400 shadow-lg shadow-amber-200/50",
  tickerText: "text-stone-800", smallBtn: "bg-stone-100 hover:bg-stone-200 text-stone-600",
  delBtn: "bg-stone-100 hover:bg-red-100 text-stone-600", grip: "text-stone-300 hover:text-stone-500",
  meta: "text-stone-400", priceBox: "bg-amber-50 border-amber-400", priceText: "text-stone-800",
  up: "text-teal-600", down: "text-red-500", label: "text-stone-500", body: "text-stone-700", bodyMuted: "text-stone-600",
  bullBox: "bg-teal-50 border-teal-300", bullLabel: "text-teal-600", bearBox: "bg-red-50 border-red-300", bearLabel: "text-red-500",
  catBox: "bg-sky-50 border-sky-300", catLabel: "text-sky-600", macroBox: "bg-amber-50 border-amber-300", macroLabel: "text-amber-600", macroSub: "text-stone-500",
  buzzBox: "bg-violet-50 border-violet-300", buzzLabel: "text-violet-600", watchIcon: "text-amber-500",
  empty: "text-stone-400", error: "text-red-500", stale: "text-amber-700 border-amber-300 bg-amber-100",
  srcLink: "text-sky-600 hover:text-sky-500", noteBox: "bg-stone-50 border-stone-200", noteText: "text-stone-600",
  digestBox: "bg-white border-stone-300 shadow-sm", digestLabel: "text-amber-600", valueBar: "bg-white border-stone-300 shadow-sm",
  sharesInput: "bg-stone-50 border-stone-300 text-stone-700 focus:border-amber-400",
};
