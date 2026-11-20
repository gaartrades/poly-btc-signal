# Poly BTC Signal v1.7 — iPhone / GitHub Pages

A free, read-only 15-minute **Polymarket US BTC** signal dashboard. It uses the Polymarket US public gateway and its BTC reference-price history. It does **not** support the international Polymarket.com / Chainlink market, place orders, or access an account.

**Warning:** Experimental predictions are not guaranteed. The *model UP estimate* is **uncalibrated** unless a time band later passes the independent-settlement validation shown by the app. The 0–100 setup-quality score is **never** a win probability. Observed paper bid touches are not proof of fills, real profit, or settled wins.

## Replace v1.6 via GitHub on an iPhone

1. Download and extract the ZIP using the iPhone **Files** app.
2. Open the *same existing* GitHub repository that hosts the Polymarket dashboard. No new repository is needed.
3. Upload **all files in this ZIP to the repository root**, replacing files with matching names. Keep the supplied **`calibration.js`** and all other files together. Important: don't put the files inside an extra ZIP-named subfolder.
4. Commit the upload. Leave **Settings → Pages** configured to publish the `main` branch at `/ (root)`.
5. Reopen the existing Pages URL. If the PWA keeps an old version, open the GitHub Pages URL in Safari and reload; the shell and scripts have new v1.7 cache identifiers. iOS Home Screen copies should update on an active reload.
6. Confirm footer says **v1.7**, header says **Target 1s quotes/index · 5s model**, and a **Probability calibration** panel appears.

No code editing, cloud servers, paid data subscriptions, or account credentials are required. The app is a **frontend**, not a persistent unattended server.

## What's new in v1.7

- **More selective entries:** rejects two strongly opposing 1m/3m/5m BRTI momentum horizons, 20-second sharp reversals, and sudden reference-price shocks.
- **Probability sensitivity check:** reduces the model's claimed directional strength by 30% and requires the resulting quote margin to remain positive. The *stressed edge* is a scenario, **not** a confidence interval or verified profit edge.
- **Minimum target/risk check:** no suggested entry if the indicated take-profit distance is insufficient relative to the suggested stop distance.
- **Instant quote invalidation:** withdraws a suggested BUY if the ask moves more than 3¢ since the last model update, its calculated edge disappears, its bid crosses an exit trigger, the market changes, or fresh data stops arriving.
- **Better feed guard:** rejects future-dated BRTI ticks, discontinuous minute history and wrong-window market metadata. A stale market cannot remain displayed as an active new BUY after polling stalls or the app is backgrounded.
- **Improved diagnostics:** adds stressed-edge and directional-momentum agreement metrics; corrects the public market link; fixes text claiming two confirmations (it has always required three).
- **Existing history preserved:** uses exactly the same paper/training localStorage keys; retains the unchanged v1.6 raw probability formula and calibration version, so prior observations remain comparable. New paper setups are tagged `v1.7` in the CSV, and the paper history cap grows to 500 records.

**Performance warning:** These extra heuristics intentionally reduce signals. They have not been independently backtested or shown to improve net returns. Live data and live trading are not verified here. Keep collecting official-settlement evidence, and export backups before replacing files.

### Why time bands?

A prediction made two minutes into a 15-minute market isn't comparable to one made with only three minutes left. The app does not pool these horizons indiscriminately.

### How settlement sync works

- At least 15 seconds after the market ends, the app can look up a locally recorded market and see if its official final outcome has been published. It checks at most one previously observed market at a time, with a per-market cooldown, and retries unresolved ones **while the app is open**. The **Check settlements** button triggers an immediate eligible check.
- **Target/stop touches are not used** for calibration, and expiry without a published settlement is left **unverified**.
- v1.5 paper outcomes cannot be retroactively turned into calibration rows, because v1.5 did not archive a comparable raw probability at fixed time bands with verified settlement labels.
- Logging requires the app to be visible. **GitHub Pages cannot continue polling or fetch historical snapshots while the iPhone app is closed.** iOS can suspend background tabs, and no push notifications are promised.
- After 240 verified snapshots, calibration may **still remain uncalibrated** if the held-out test does not show better prediction quality.

## Main files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | iPhone UI and data cards |
| `app.js` | Public API requests, hybrid polling and backoff, interface, settlement checks |
| `engine.js` | Direction probability and price-edge logic (no API keys) |
| `tracker.js` | Signal confirmation, simulated bid tracking, persistence and paper CSV |
| `calibration.js` | Local per-horizon outcome dataset, validation, probability adjustment and CSV |
| `sw.js`, `manifest.webmanifest`, icons | GitHub Pages/iPhone Home Screen install shell |
| `test-*.js` | Offline Node.js smoke tests for the engine, tracker and calibrator |

## Data sources, terms and safeguards

Public Polymarket US gateway `https://gateway.polymarket.us`:
- `GET /v1/market/slug/{slug}` — verify 15-minute market metadata, current official price to beat, final market status.
- `GET /v1/markets/{slug}/bbo` — UP best bid/offer, deriving binary DOWN as complementary prices.
- `GET /v1/asset-prices/history?...&bucket=ASSET_PRICE_BUCKET_1S` — BTC reference samples for fast index and short reversal.
- `GET /v1/asset-prices/history?...&bucket=ASSET_PRICE_BUCKET_1M` — longer price/momentum history.
- `GET /v1/markets/{slug}/settlement` — final official settled outcome, used **only** after the market is marked resolved.

Official Polymarket US SDK: https://github.com/Polymarket/polymarket-us-typescript (see market BBO and settlement endpoints).

The API's CORS policy and rate limits may change; v1.7 has been run through synthetic mocked-browser and Node tests, but *live 1-second API access and real-market calibration collection have not been independently verified in the test environment*. If the source is blocked or stale, the app stops issuing fresh signals.

**Privacy:** No credentials are required. Paper results and calibration rows stay in that iPhone browser's site storage until erased/exported. No server-side user data retention is provided.

## Run local smoke tests (optional, not needed on iPhone)

```bash
node test-engine.js
node test-tracker.js
node test-calibration.js
node test-hardening.js
```

## Troubleshooting

- **No signal / DATA DELAY**: see Data diagnostics. 429s cause backoff; intermittent 404s or unavailable market metadata will stop new entries rather than fabricate data.
- **NO TRADE with a model probability shown**: market price may already account for the prediction; edge is below estimated fee/slippage buffer. Model probability is not an entry instruction.
- **Confirming 1/3, 2/3**: qualifying checks must remain valid over ten seconds, with fresh reference samples.
- **0 verified outcomes**: normal at first. Recording one early/mid/late snapshot does not prove a final market result. Settlement sync can resume later when you open the app.
- **Existing paper history missing**: make sure you opened the **same domain and path** on the **same iPhone**, not a new repository or browser profile. Export before clearing website data.
- **Not 1 request exactly per second**: 1 second is a target; network latency, browser throttling, and rate-limit backoff can reduce actual polling speed.

v1.7 · Independent analysis; not affiliated with or endorsed by Polymarket.
