import { useState, useEffect, useRef } from "react";
import {
  Plus, X, RefreshCw, TrendingUp, Eye, ChevronUp, ChevronDown,
  GripVertical, Sun, Moon, Link, StickyNote, Layers, Wallet, Settings, KeyRound,
} from "lucide-react";

// ----------------------------------------------------------------------------
// CONFIG
// ----------------------------------------------------------------------------
// Where the Anthropic proxy lives. In production on Vercel this is just "/api/analyze".
// For local dev without a function runner, you can deploy the proxy and point here.
const PROXY_URL = "/api/analyze";

// localStorage keys
const LS = {
  tickers: "pp-tickers",
  results: "pp-results",
  theme: "pp-theme",
  notes: "pp-notes",
  shares: "pp-shares",
  digest: "pp-digest",
  anthropicKey: "pp-anthropic-key",
  finnhubKey: "pp-finnhub-key",
};

const STALE_MS = 24 * 60 * 60 * 1000;

const KNOWN_SECTORS = {
  TSLA: "EV / Auto", BTC: "Crypto", AMD: "Semiconductors", AMZN: "Consumer / Tech",
  PLTR: "Software / Defense", FSLR: "Solar / Energy", SPCX: "Space / Aerospace",
  AAPL: "Consumer Tech", NVDA: "Semiconductors", MSFT: "Software / Tech",
  GOOG: "Tech / Ads", GOOGL: "Tech / Ads", META: "Social / Tech", ETH: "Crypto",
};

// Finnhub uses different symbols for crypto. Map the common ones.
const CRYPTO_MAP = { BTC: "BINANCE:BTCUSDT", ETH: "BINANCE:ETHUSDT" };

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

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
  const sources = [];
  const seen = new Set();
  for (const block of content || []) {
    const items = block?.content;
    if (Array.isArray(items)) {
      for (const item of items) {
        const url = item?.url;
        const title = item?.title;
        if (url && !seen.has(url)) {
          seen.add(url);
          sources.push({ url, title: title || url });
        }
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

  const resultsRef = useRef(results);
  const tickersRef = useRef(tickers);
  const cardRefs = useRef({});

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { tickersRef.current = tickers; }, [tickers]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // Open settings automatically if no keys yet.
  useEffect(() => {
    if (!anthropicKey || !finnhubKey) setShowSettings(true);
  }, []); // eslint-disable-line

  // ---- Live price fetching (Finnhub, direct browser calls allowed) ----
  const fetchPrice = async (ticker) => {
    if (!finnhubKey) return;
    const symbol = CRYPTO_MAP[ticker] || ticker;
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`);
      const d = await r.json();
      // Finnhub quote: c = current, dp = percent change, t = timestamp
      if (typeof d.c === "number" && d.c > 0) {
        setLivePrices((p) => ({
          ...p,
          [ticker]: { price: d.c, changePct: d.dp, at: d.t ? new Date(d.t * 1000).toLocaleTimeString() : null },
        }));
      }
    } catch {}
  };

  const fetchAllPrices = async () => {
    for (const t of tickersRef.current) {
      await fetchPrice(t);
      await new Promise((r) => setTimeout(r, 1100)); // free tier ~60/min
    }
  };

  useEffect(() => {
    if (finnhubKey) fetchAllPrices();
    // eslint-disable-next-line
  }, [finnhubKey]);

  // ---- persistence helpers ----
  const saveTickers = (arr) => { setTickers(arr); tickersRef.current = arr; lsSet(LS.tickers, arr); };
  const persistResults = (r) => { setResults(r); resultsRef.current = r; lsSet(LS.results, r); };
  const saveNote = (t, text) => {
    const n = { ...notes };
    if (text.trim()) n[t] = text.trim(); else delete n[t];
    setNotes(n); lsSet(LS.notes, n);
  };
  const saveShares = (t, val) => {
    const s = { ...shares };
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) s[t] = num; else delete s[t];
    setShares(s); lsSet(LS.shares, s);
  };
  const toggleTheme = () => { const n = !dark; setDark(n); lsSet(LS.theme, n ? "dark" : "light"); };

  const saveKeys = (ak, fk) => {
    setAnthropicKey(ak); setFinnhubKey(fk);
    lsSet(LS.anthropicKey, ak); lsSet(LS.finnhubKey, fk);
  };

  const addTicker = () => {
    const t = input.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (t && t.length <= 10 && !tickers.includes(t)) {
      saveTickers([...tickers, t]);
      fetchPrice(t);
    }
    setInput("");
  };

  const removeTicker = (t) => {
    saveTickers(tickers.filter((x) => x !== t));
    const r = { ...resultsRef.current }; delete r[t]; persistResults(r);
  };

  const handleDragStart = (e, i) => {
    e.preventDefault();
    setDragIdx(i);
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const list = tickersRef.current;
      let target = null;
      for (let k = 0; k < list.length; k++) {
        const el = cardRefs.current[list[k]];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) { target = k; break; }
      }
      setDragIdx((cur) => {
        if (cur === null || target === null || target === cur) return cur;
        const arr = [...tickersRef.current];
        const [item] = arr.splice(cur, 1);
        arr.splice(target, 0, item);
        tickersRef.current = arr; setTickers(arr);
        return target;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      setDragIdx(null);
      lsSet(LS.tickers, tickersRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  // ---- Claude analysis via proxy ----
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
    fetchPrice(ticker); // refresh live price alongside
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

  // ---- portfolio math (uses LIVE prices, falls back to nothing) ----
  const priceOf = (t) => livePrices[t]?.price ?? null;
  const positions = tickers.map((t) => {
    const price = priceOf(t);
    const qty = shares[t];
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
      const price = priceOf(t);
      const qty = shares[t];
      const value = price && qty ? price * qty : null;
      return {
        ticker: t, sector: r.sector || KNOWN_SECTORS[t] || null,
        sharesOwned: qty || null,
        positionValue: value ? Math.round(value * 100) / 100 : null,
        weightPct: value && totalValue > 0 ? Math.round((value / totalValue) * 1000) / 10 : null,
        summary: r.summary, bullCase: r.bullCase, bearCase: r.bearCase,
        catalysts: r.catalysts, macroEvents: r.macroEvents,
      };
    }).filter(Boolean);
    if (available.length < 2) {
      setDigest({ error: "Analyze at least 2 tickers first." });
      return;
    }
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
  const toggleCollapseAll = () => {
    const next = {};
    allCollapsible.forEach((t) => (next[t] = !allCollapsed));
    setCollapsed(next);
  };

  const T = dark ? THEME_DARK : THEME_LIGHT;

  return (
    <div className={`min-h-screen ${T.page} p-6 transition-colors pf-sans`}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between mb-1">
          <h1 className={`text-2xl font-bold ${T.title}`}>Portfolio Pulse</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowSettings(true)} className={`${T.smallBtn} rounded-sm p-2 transition-colors`} title="Settings / API keys">
              <Settings size={16} />
            </button>
            <button onClick={toggleTheme} className={`${T.smallBtn} rounded-sm p-2 transition-colors`} title={dark ? "Light mode" : "Dark mode"}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
        <p className={`${T.sub} text-sm mb-6`}>
          Neutral, source-attributed news analysis with live prices. Educational, not financial advice.
        </p>

        {(!anthropicKey || !finnhubKey) && !showSettings && (
          <div className={`${T.macroBox} border-l-2 rounded-sm px-3 py-2 mb-4 text-sm flex items-center justify-between`}>
            <span className={T.body}>Add your API keys to start.</span>
            <button onClick={() => setShowSettings(true)} className={`${T.addBtn} rounded-sm px-3 py-1 text-xs font-medium`}>Open Settings</button>
          </div>
        )}

        {/* controls */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTicker()}
            placeholder="Add ticker (e.g. TSLA)"
            className={`flex-1 min-w-[140px] ${T.input} border rounded-sm px-3 py-2 text-sm focus:outline-none pf-mono`}
          />
          <button onClick={addTicker} className={`${T.addBtn} rounded-sm px-4 py-2 flex items-center gap-1 text-sm font-medium transition-colors`}>
            <Plus size={16} /> Add
          </button>
          <button onClick={analyzeAll} disabled={runningAll} className={`${T.allBtn} disabled:opacity-50 rounded-sm px-4 py-2 flex items-center gap-1 text-sm font-medium transition-colors`}>
            <RefreshCw size={16} className={runningAll ? "animate-spin" : ""} />
            {runningAll ? "Running..." : "Analyze All"}
          </button>
          <button onClick={generateDigest} disabled={digestLoading} className={`${T.smallBtn} rounded-sm px-3 py-2 flex items-center gap-1 text-sm font-medium transition-colors disabled:opacity-50`} title="Cross-portfolio assessment (no searches)">
            <Layers size={16} className={digestLoading ? "animate-pulse" : ""} />
            {digestLoading ? "Working..." : "Digest"}
          </button>
          {allCollapsible.length > 0 && (
            <button onClick={toggleCollapseAll} className={`${T.smallBtn} rounded-sm px-3 py-2 flex items-center gap-1 text-sm font-medium transition-colors`}>
              {allCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              {allCollapsed ? "Expand" : "Collapse"}
            </button>
          )}
        </div>

        {valuedPositions.length > 0 && (
          <div className={`${T.valueBar} border rounded-sm px-4 py-3 mb-3 flex items-baseline gap-3 flex-wrap`}>
            <span className="flex items-center gap-1.5">
              <Wallet size={14} className={T.digestLabel} />
              <span className={`${T.label} text-xs uppercase tracking-wider`}>Portfolio Value</span>
            </span>
            <span className={`text-xl font-bold ${T.priceText} pf-mono`}>{fmtMoney(totalValue)}</span>
            <span className={`text-xs ${T.meta}`}>{valuedPositions.length} of {tickers.length} positions · live prices</span>
          </div>
        )}

        {digest && <DigestCard digest={digest} T={T} onClose={() => { setDigest(null); lsSet(LS.digest, null); }} />}

        <div className="space-y-4">
          {tickers.map((t, i) => (
            <TickerCard
              key={t} t={t} i={i}
              r={results[t]} live={livePrices[t]}
              loading={loading[t]} runningAll={runningAll}
              collapsed={collapsed[t]} dragging={dragIdx === i}
              sector={results[t]?.sector || KNOWN_SECTORS[t]}
              note={notes[t]} shares={shares[t]} totalValue={totalValue}
              showSources={showSources[t]} editingNote={editingNote === t}
              now={now} T={T} dark={dark}
              cardRef={(el) => (cardRefs.current[t] = el)}
              onDragStart={(e) => handleDragStart(e, i)}
              onAnalyze={() => analyze(t)}
              onRemove={() => removeTicker(t)}
              onToggleCollapse={() => setCollapsed((c) => ({ ...c, [t]: !c[t] }))}
              onToggleNote={() => setEditingNote(editingNote === t ? null : t)}
              onSaveNote={(v) => { saveNote(t, v); setEditingNote(null); }}
              onSaveShares={(v) => saveShares(t, v)}
              onToggleSources={() => setShowSources((s) => ({ ...s, [t]: !s[t] }))}
            />
          ))}
          {tickers.length === 0 && <p className={`${T.empty} text-sm text-center py-8`}>Add a ticker to get started.</p>}
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          T={T} anthropicKey={anthropicKey} finnhubKey={finnhubKey}
          onSave={(ak, fk) => { saveKeys(ak, fk); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// (TickerCard, DigestCard, SettingsModal, THEME_DARK, THEME_LIGHT follow in the
//  next message — split out so each piece stays readable.)
