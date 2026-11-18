# Poly BTC Signal · iPhone · v1.5

Read-only Polymarket US Bitcoin 15-minute dashboard with reference-index analysis, a 0–100 *heuristic* setup-quality score, executable bid/ask quotes, suggested entry/target/stop prices, and LOCAL paper tracking. Free to host using GitHub Pages. No account login, orders, private trading keys, or automatic trades.

## Updating your existing GitHub Pages bot on iPhone

1. Download **poly-btc-signal-iphone-v1.5.zip** and extract it in the iPhone **Files** app.
2. Open the GitHub repository that already hosts your Polymarket dashboard.
3. Upload the **app files directly into the repository root**, replacing the existing same-named files. Upload:
   - `index.html`, `app.js`, `engine.js`, `tracker.js`, `styles.css`
   - `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`
4. Commit the upload to your `main` branch. GitHub Pages should publish the update at the **same URL** as before.
5. Reopen the app. If it looks unchanged, refresh the page in Safari (or close/relaunch the Home Screen app) while connected to the internet. The script links and PWA shell cache are bumped to `v5`.

If GitHub refuses an upload because a file with the same name already exists, use the repo's file **Replace / Upload file** option, or edit that file from its GitHub view via the upload/replacement workflow. You do NOT need to manually paste or edit code. `README.md` and `test-*.js` are documentation/tests only; uploading them is optional.

**Important:** Do not upload the enclosing ZIP or an enclosing subfolder as the site root. The `index.html` file must stay at the repo root, alongside `app.js`, `engine.js`, and **the new `tracker.js`**.

## Changes in v1.5

**1. Two fresh confirmations.** A potential signal becomes **CONFIRMING UP/DOWN** first. It becomes **BUY UP/DOWN** only after a second qualifying poll, at least ~4 seconds later, with a newer reference-index timestamp. A failed poll, NO TRADE decision, long pause, or iPhone backgrounding breaks that confirmation chain. Normal polling is approximately every 5 seconds **while visible**, subject to data-server and iOS limits.

**2. Automatic locked paper setup.** The FIRST confirmed signal in each 15-minute market automatically saves its original entry ASK, target selling BID, stop selling BID, side, setup score, time, and last observed selling BID. No need to press Track. If a new signal vanishes, the saved entry/target/stop remain visible as **LOCKED PAPER**, clearly labeled *not a new entry recommendation*. Only one sample per market is recorded to reduce cherry-picking / duplicate results.

**3. Local result history and score buckets.** While the app is open, it checks the active paper setup's selling bid. The first **observed** target or stop touch is saved as an outcome; when the market ends without an observed exit, it is marked **unresolved**. Historical summaries are organized by heuristic score ranges (0–59, 60–69, 70–79, 80–100). You can export the history to CSV on your iPhone or erase local results. The record lives in the browser's localStorage for **this device/browser only**. It does not synchronize with other devices and can be lost if site storage is cleared.

**4. Safer result reporting.** Target/stop contacts are simulated BID *observations*, not trade fills or verified profit/loss. The CSV contains the indicative bid-vs-entry movement for observed exits, before fees and slippage. If the phone slept, a price was skipped, or the market expired without a confirmed exit, results are unresolved. A 74/100 score is NOT a 74% success probability and this performance tracker does NOT by itself calibrate the forecasting model.

## Existing market model and APIs (unchanged)

- Venue: **Polymarket US** (`polymarket.us`), not international Polymarket.com. The US contract's index reference is BRTI; the international market uses different resolution sources and contracts.
- Market: `GET https://gateway.polymarket.us/v1/market/slug/cpc-btc-updown-15m-YYYY-MM-DD-HHMMz`
- Executable best bid/offer: `GET https://gateway.polymarket.us/v1/markets/{slug}/bbo`
- Reference series: `GET https://gateway.polymarket.us/v1/asset-prices/history?assets=crypto:btc&from=...&to=0&bucket=ASSET_PRICE_BUCKET_1S`, with additional one-minute history.
- Official price-to-beat comes from verified market metadata. Down-side prices are calculated as the binary complement of the UP book. The quote/price reads must be fresh for a new signal.
- Model considers BRTI price gap, 1/3/5/10-minute momentum, estimated volatility, current ask, and observed spread. This model has not been independently backtested or proven profitable.

Polymarket US API docs:
- https://docs.polymarket.us/api-reference/asset-prices/overview
- https://docs.polymarket.us/api-reference/markets/get-market-by-slug
- https://docs.polymarket.us/api-reference/markets/get-market-bbo

## Limitations

- The browser can only refresh in the foreground. Closing/locking the iPhone can suspend both live updates and paper outcome monitoring.
- GitHub Pages cannot host a 24/7 server process or fix an API that blocks browser cross-origin calls.
- Quotes are top-of-book indicators; order size, fees, slippage, market suspension and settlement timing can change actual results. Suggested exits are not guaranteed executable.
- A signal is read-only; it **never places an order**.
- Do not put API keys or personal trading credentials in this repository.

## Tests

`node test-engine.js` verifies the existing model and market-data parsing. `node test-tracker.js` verifies two-refresh confirmation, the locked entry/exit, target/stop observation, unresolved expiry, per-score reporting, and CSV persistence logic.
