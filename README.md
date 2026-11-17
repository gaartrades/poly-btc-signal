# Poly BTC Signal · 15m — Polymarket US

An **iPhone-friendly, read-only** Bitcoin 15-minute dashboard with a heuristic setup score, market entry quotes, estimated trading edge, suggested take-profit and stop-loss prices, and manual *simulated* setup watching.

**Platform:** Polymarket **US** (`polymarket.us`), NOT international `polymarket.com`. Polymarket US uses CF Benchmarks' BRTI for this 15-minute market; international Polymarket.com uses Chainlink and different contracts. Do not swap prices across these venues.

## Quick iPhone setup — new GitHub repository

1. In Safari, log into GitHub, create a **new public repository** (e.g. `poly-btc-signal`). Keep it separate from your existing Kalshi project.
2. Upload all the files in this folder **into the repository root** (do not nest them inside a folder):
   `index.html`, `app.js`, `engine.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`.
3. Open repository **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, `main`, `/ (root)` and save.
4. When Pages publishes, open `https://YOUR-GITHUB-USERNAME.github.io/poly-btc-signal/` in **Safari** on your iPhone.
5. In Safari Share → **Add to Home Screen**. Keep the app open in the foreground for 5-second updates.

To upload a ZIP on iPhone, use the iOS Files app to unzip it, then GitHub's **Add file → Upload files**. GitHub's mobile view may require Safari's **Request Desktop Website** to multi-select files. Alternatively, create `index.html` manually and upload the others.

## Market and quote data

- Market lookup: `GET https://gateway.polymarket.us/v1/market/slug/{slug}` where UTC market slug is `cpc-btc-updown-15m-YYYY-MM-DD-HHMMz`.
- Official reference market metadata: `assetPriceTerms.priceToBeat`, `windowStart`, `windowEnd`.
- Order-book best bid/offer: `GET https://gateway.polymarket.us/v1/markets/{slug}/bbo`.
- Settlement reference BTC prices: `GET https://gateway.polymarket.us/v1/asset-prices/history?assets=crypto:btc&from=...&to=0&bucket=ASSET_PRICE_BUCKET_1S` plus one-minute long history.
- Up buy = UP best ask; UP immediate cash-out = UP best bid.
- Down derived from the same complementary binary orderbook: Down buy = 1 − Up best bid, Down cash-out = 1 − Up best ask. Prices are indicative best levels for a small order; larger order sizes may fill worse.

Official sources:
- https://docs.polymarket.us/api-reference/asset-prices/overview
- https://docs.polymarket.us/api-reference/markets/get-market-by-slug
- https://docs.polymarket.us/api-reference/markets/get-market-bbo
- https://polymarket.us/event/cpc-btc-updown-15m-2026-10-06-1900z

## Fix in version 1.4

Corrected market slugs to the Polymarket US `cpc-btc-updown-15m-YYYY-MM-DD-HHMMz` format. The prior build incorrectly omitted `cpc-`, producing 404 responses. Reference: official Polymarket US [Asset Price API overview](https://docs.polymarket.us/api-reference/asset-prices/overview) uses this market slug in its opening-index example. Version bumped to v4 to refresh iPhone cached scripts. A specific window may still be unlisted and some browsers or connections may block data; no signals are shown until all live feeds validate.

## Strategy / safety

This is an **experimental heuristic**. It computes 1-, 3-, 5- and 10-minute BTC momentum on the reference index, realized minute volatility, spot-vs-official-price-to-beat, a shrunk normal-CDF model for a binary UP/Down estimate, and modeled value-versus-entry quotes. The `x/100` **setup score is NOT a tested win rate or calibrated probability**; the displayed model-up estimate is also uncalibrated.

The app is deliberately permissive (quality score ≥54), but **refuses** entry if:
- Market/price-to-beat/reference feed/order book are missing, invalid, or stale.
- Spread is wider than 8.5 cents.
- Buying price is less than 8 or greater than 84 cents.
- Estimated edge doesn't exceed a conservative fee/slippage reserve.
- The market is in the first 40s or last 100s (settlement averages final 60s BRTI prints).
- A severe short-term reversal undermines a weaker signal.

Targets and stops are *selling-bid triggers* (target approx +9 to +18 cents; stop approx −8.5 to −11.5 cents depending on spread). **These are not executable orders or guaranteed fills**. The simulator assumes no actual entry, fee, or account position, and stores one watch locally in this iPhone browser. Closing the app suspends updates, including watched exit triggers.

API rate: the app asks for current BBO and short reference history every **5 seconds while visible**, updates longer history about once per 45 seconds, and refreshes the market metadata periodically. If an API call fails or is blocked by cross-origin restrictions, the dashboard **fails closed** with no signal. GitHub Pages cannot bypass API CORS or run an always-on backend; if access is blocked, a compatible server-side proxy would be required.

**No automated real-money trading. No push alerts in the background. No independent calibrated backtesting has been performed.** Never put trading API keys into this public repository.
