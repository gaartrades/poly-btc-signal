# Poly BTC Signal v1.8 — Adaptive Edge (Polymarket US)

**Read-only iPhone / GitHub Pages BTC 15-minute dashboard.** Preserves the existing v1.7 model, calibration records, paper history, manifest and site address. It NEVER trades for you or reads any private account details. This is **Polymarket US** (`polymarket.us`, `gateway.polymarket.us`), **NOT** the international Polymarket.com / Chainlink BTC market.

## Install on iPhone — replace existing files

1. Download the v1.8 ZIP, tap it in iPhone Files to unzip, and open the extracted folder.
2. Open your **existing** GitHub Pages repo (`poly-btc-signal`, if you kept the original name). Do **not** create a new repository.
3. On its **main** branch, choose **Add file → Upload files** (desktop-site view if needed); add **all 17 root files** from the folder, replacing any older matching names. **Do not** upload the ZIP itself or nest everything in a folder.
4. Commit to **main**. Leave **Settings → Pages → Deploy from a branch → main → /(root)** unchanged.
5. Open your original GitHub Pages address in Safari, reload, and then reopen your Home Screen PWA. Look for **v1.8** in the footer, the **Execution assumptions** panel, and metrics for **Market regime / Cost-adjusted margin / Depth impact**.
6. Leave **Fee tier = Tier 1** unless you know your Polymarket **US app** taker tier. If the order book never loads, check **Data diagnostics**; the upgraded bot deliberately shows **NO TRADE** instead of guessing liquidity.

Export your existing paper & calibration CSVs **before replacing** files. The existing localStorage keys remain unchanged and old v1.7 samples will not be erased by installing v1.8. Storage is per-browser/domain/path, so changing the GitHub Pages address would hide that local history.

## Improvements over v1.7

- **Five-contract illustrative book-depth guard**: fetches `GET /v1/markets/{slug}/book` roughly every 12 seconds; requires visible liquidity to BUY and SELL, rejects >2.5¢ estimated top-of-book impact, stale (>18s) depth or mismatched BBO vs full book. Existing 1-second best bid/ask and index refresh remains best effort while visible.
- **US fee-aware entry filter**: exact *unrounded* formula from US exchange terms: `theta × contracts × price × (1 - price)`. Estimates buy and possible early sell fees, plus 1¢ quote-shift buffer. Default theta 0.095 (app Tier 1); selectable Tier 2 0.085, Tier 3 0.075, Tier 4 0.0695. Actual execution fees are rounded and can differ per fill. Does NOT apply promotions, API-only rebates, or maker rebates.
- **Adaptive regime filter**: labels trends, ranges, choppy/reversals and high volatility from recent BRTI history. Tightens the required cost-adjusted margin in unstable conditions. Heuristic, NOT empirically optimized.
- **Indicative cost-aware paper estimates**: new v1.8 histories may record fee-adjusted *illustrative* P/L for five contracts only when entry had verified depth and an exit was observed with fresh matched depth. Old bid-touch history remains in place and is not retroactively reclassified. Book presence cannot prove a real order would have filled.
- **Strict fail-closed behavior**: new trades are rejected when full depth is missing, stale or cannot support the illustrative size. API 429 backoff retained; avoids assuming book liquidity from BBO totals.
- **Same raw prediction model and calibration schema**: the historical 1.6 probability formula is preserved exactly; it is still *uncalibrated* until later official settlement validation passes the existing holdout test. Setup score remains a heuristic, not win probability.

## Important limitations

- **NOT tested against live market responses in this execution environment.** Official REST endpoint paths were checked against Polymarket US documentation, but browser cross-origin requests, production live values, price-to-beat timing, actual fee tier, order fill, and stable 1-second polling could not be validated here. If `/book` fails or the response structure changes, entries stop rather than bypass the check.
- `GET /v1/markets/{slug}/book` can be rate-limited or unavailable. One 12-second snapshot is still not a guarantee of fill 5-15 seconds later. The bot does not place orders. No push notifications or background execution from GitHub Pages/iPhone PWA when suspended.
- Forecast probability remains an experimental statistical heuristic. No backtest demonstrating superior profit has been run. Do not treat “modeled edge” or paper earnings as verified profitability.
- The US fee tiers and API promotion are different from Polymarket.com fees. The November 21–December 31, 2026 API rebate program is NOT assumed for ordinary app trades. Confirm your current fee tier and any changes in official docs.

## Files

`index.html`, `styles.css`, `app.js`, `engine.js`, `execution.js`, `tracker.js`, `calibration.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `test-engine.js`, `test-execution.js`, `test-tracker.js`, `test-calibration.js`, `test-hardening.js`.

## Offline tests (optional, on a PC; no tests required on iPhone)

```bash
node test-engine.js
node test-execution.js
node test-tracker.js
node test-calibration.js
node test-hardening.js
```

The smoke tests use synthetic fixtures, NOT live market data. `test-hardening.js` is now stand-alone (the earlier v1.7 archive mistakenly referred to a missing `../poly_original/engine.js`).

## Public documentation

- https://docs.polymarket.us/fees.md
- https://docs.polymarket.us/api-reference/markets/get-market-book.md
- https://docs.polymarket.us/api-reference/markets/get-market-bbo.md
- https://docs.polymarket.us/api-reference/asset-prices/get-a-bucketed-ohlc-price-series-for-one-or-more-assets.md
- https://github.com/Polymarket/polymarket-us-typescript

v1.8 · Independent, educational, not endorsed by Polymarket.
