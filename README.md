# # Portfolio Pulse
https://portfolio-pulse-plum.vercel.app/ <--paste this URL to try it out

Most AI stock dashboards are hype machines: paste a ticker, get a wall of reasons to buy. **Portfolio Pulse is built to do the opposite.** Every analysis presents the bull case and bear case with equal effort, attributes opinions to their sources, labels speculation as speculation, and keeps raw social-media sentiment in its own clearly-marked section so it never bleeds into the sober analysis. The goal is to inform a decision, not steer one.

Live prices come from Finnhub. News analysis, balanced cases, and the portfolio-level assessment come from Claude. **You bring your own API keys** (both have free tiers) and they live only in your browser.

🔗 **Live demo:** YOUR_VERCEL_URL

![screenshot](docs/screenshot.png)

## Why it's different

- **Neutrality by construction.** The prompts forbid loaded language ("soars," "tanks"), require source attribution, and weight bull and bear cases equally.
- **Speculation is labeled.** Real-world events (legislation, shortages, tariffs) only surface when significant, and each potential impact is tagged as either sourced analysis or an inference.
- **Street Talk stays raw.** Retail sentiment from Reddit / StockTwits / X is summarized in its own voice and exempt from the neutrality rules, so you see the mood without it contaminating the facts.
- **Portfolio-level view.** Enter share counts for live position values and weights, plus a cross-portfolio assessment grounded in academic finance concepts (diversification, concentration risk) described, never prescribed.

## Features

- Live prices and intraday percent change (Finnhub)
- Per ticker: balanced news analysis, bull/bear cases, catalysts, watch-list, real-world events, social sentiment, source links
- Portfolio value and per-position weights from your share counts
- Cross-portfolio "Digest" assessment from already-fetched data (no extra searches)
- Personal notes per ticker, drag-to-reorder, collapse/expand, stale-data flags
- Dark and light themes, everything saved to your browser

## Tech

React + Vite, Tailwind, deployed on Vercel with a tiny serverless proxy for the Anthropic API. No backend database; all state is in localStorage.

## Run it yourself

```bash
git clone https://github.com/jacobmarginean1-spec/portfolio-pulse.git
cd portfolio-pulse
npm install
```

Then deploy on Vercel (the app needs the `api/analyze.js` serverless function, which Vercel runs for free):

```bash
npm i -g vercel
vercel
```

Open the deployed URL, click the gear icon, and paste your keys.

### Get the keys (both free to start)

- **Anthropic:** [console.anthropic.com](https://console.anthropic.com) → API Keys. Pay-as-you-go; each analysis costs a small amount of credit, so add a few dollars to your balance.
- **Finnhub:** [finnhub.io/register](https://finnhub.io/register) → free tier, about 60 calls per minute.

## How it handles your data

API keys are stored only in your browser's localStorage and sent directly to Anthropic (via your own proxy) and Finnhub. Nothing is logged or shared. The proxy forwards your request and stores nothing. Your portfolio, notes, and results all stay on your machine.

## Limitations

- **Not financial advice.** It's an information tool. The principles section is educational, not personalized guidance.
- **Analysis quality depends on search results.** Claude summarizes whatever its web searches surface; thinly-covered tickers get thinner analysis.
- **Free-tier rate limits apply** on both APIs. "Analyze All" is paced to respect them; heavy use will still hit caps.
- **Crypto support is basic.** BTC and ETH are mapped to Finnhub's Binance feeds; other coins need adding to `CRYPTO_MAP` in the source.

## License

MIT. Do what you like, no warranty.

## Contributing

Issues and PRs welcome. The neutrality framing is the soul of the project; changes that turn it back into a hype generator will be declined.


