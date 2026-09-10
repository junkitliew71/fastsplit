# FastSplit

**Don’t split equally. Pay for what you ate.**

A mobile-first React + TypeScript web app. GitHub Pages serves the frontend; Google Apps Script reads and writes a private Google Sheets database. No Node server, Firebase, or paid hosting is required.

## What works

- Manual receipt entry, editable quantities and prices, service charge, SST and discounts.
- Camera image selection, upload, preview and replacement. Optional server-side Gemini OCR; no keys in the frontend.
- Add, rename and remove people. Every quantity becomes an individually assignable unit; multiple people can share any unit.
- Integer-cent arithmetic, proportional fees and discounts, deterministic largest-remainder rounding and reconciliation.
- Automatic save after Calculate & save, explicit save confirmation, retry with duplicate prevention, temporary recoverable draft.
- Real API-backed history, read-only details, session ownership, confirmed manual deletion and 72-hour expiry.
- Share sheet with clipboard fallback, app manifest and responsive interface.
- GitHub Actions build/test/deploy workflow.

## Local development

Install Node.js 22 or later. In this directory:

```sh
npm install
cp .env.example .env.local
npm run dev
```

In PowerShell use `Copy-Item .env.example .env.local`. Set `VITE_FASTSPLIT_API_URL` in `.env.local` to the deployed URL ending in `/exec`. Restart Vite after changing it. The URL is public configuration, not a secret.

```sh
npm test
npm run build
npm run preview
```

## Google Sheets and Apps Script setup

1. Open [Google Apps Script](https://script.google.com/home/) and create a standalone project named **FastSplit API**.
2. Paste `google-apps-script/Code.gs` into `Code.gs`, then save.
3. Optionally enable the manifest in Project Settings and replace `appsscript.json` with the supplied manifest (V8 runtime).
4. Select `setupFastSplit` in the function dropdown and click **Run**. Complete Google's authorization yourself. If no authorization popup appears in an embedded browser, open the same project in Chrome and retry.
5. `setupFastSplit` creates a private spreadsheet named **FastSplit Database**, writes its ID to the `SPREADSHEET_ID` script property, creates the `Receipts` sheet and installs an hourly cleanup trigger. The database URL appears in the execution log. Re-running setup does not duplicate the database or trigger.
6. To use an existing spreadsheet instead, set `SPREADSHEET_ID` under Project Settings → Script properties before running setup.
7. Do not make the spreadsheet public. The API handles access; visitors do not need spreadsheet access.

### Deploy the API

Choose **Deploy → New deployment → Web app**. Set **Execute as: Me**, **Who has access: Anyone**, and deploy. Use the Web app URL ending in `/exec`, not the project editor URL or `/dev` testing URL. This is an anonymous app; the API verifies the random session capability on each data request. Deploying a web app does not make the spreadsheet itself public.

When changing backend code, save, then choose **Deploy → Manage deployments → Edit → New version → Deploy**. Merely saving code does not update the live API.

### API contract

All data operations are POST requests with a JSON body sent as `Content-Type: text/plain;charset=utf-8`. This avoids an unsupported preflight request. Follow the Google ContentService redirect; do not use `no-cors`, because an opaque response cannot confirm saving.

```json
{"action":"history","sessionId":"fs_<64 random hex characters>"}
```

Actions: `createReceipt` (`data`), `history`, `getReceipt` (`receiptId`), `deleteReceipt` (`receiptId`), `scanReceipt` (`image` base64 + `mimeType`). Responses are `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "..." }`. GET only exposes a non-sensitive health check. Cleanup is editor/trigger-only; there is no public cleanup endpoint.

### Database structure

The `Receipts` sheet contains:

`receiptId, sessionId, restaurant, createdAt, expiresAt, subtotalCents, serviceChargeCents, taxCents, discountCents, totalCents, participantCount, receiptDataJson`

The JSON stores canonical items, participants, unit assignments and per-person settlements. Server-generated IDs, timestamps and recalculated totals override client values. Formula-like restaurant names are escaped in spreadsheet cells.

## GitHub Pages deployment

1. Create a repository and push this project to `main`.
2. Under **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Under **Settings → Secrets and variables → Actions → Variables**, create a repository variable named `VITE_FASTSPLIT_API_URL` containing the `/exec` URL.
4. Push a commit or run **Actions → Deploy FastSplit → Run workflow**.
5. Open `https://<username>.github.io/fastsplit/` after the workflow succeeds.

Relative Vite assets and hash routes (`#/history`) keep refreshes working under the repository path without server rewrite rules.

## Scanning and demo behavior

The **Try a demo receipt** button explicitly loads a sample bill. This is the only mocked data source. It is not OCR and it is never substituted for a failed real scan. History has no mock/localStorage fallback.

Real scanning is optional. Create an API key with the provider, and store `GEMINI_API_KEY` and a currently supported image-capable `GEMINI_MODEL` in Apps Script's **Script properties**. Never put the key in Vite variables, a commit, or the public bundle. The backend forwards image bytes to Gemini, validates the response and returns structured data. The user reviews every field. Images are not written to Sheets or Drive. Provider processing/retention is governed by the provider's terms. Without these properties, scanning clearly explains that it is unavailable; manual entry still works.

## How splitting works

`src/utils/billCalculator.ts` contains the calculation engine. Money is parsed directly to integer cents. Units split equally among selected people. Service charge, tax and bill-level discount are allocated proportionally to food shares. Largest remainders receive leftover cents, with participant order breaking ties. BigInt intermediates avoid multiplication drift. All participant totals sum exactly to the bill total. Discounts cannot exceed the food subtotal. Free items need no assignment; chargeable items do.

## History, privacy and retention

`sessionService.ts` generates a cryptographically random 256-bit anonymous capability. Only the session ID and a temporary draft are stored locally. Requests pass the capability in the POST body. History is stored in Google Sheets, ordered newest-first and never returns a different session's rows. Anyone who obtains the capability can access that session's receipts; no-login capabilities are not full authentication. Clearing browser data loses access to past bills; a different device does not share history.

Creation uses one server timestamp: `expiresAt = createdAt + 72 hours`. The API excludes expired records from both history and detail requests immediately at that boundary. `cleanupExpiredReceipts` physically deletes expired rows on an hourly trigger, so row deletion may lag expiry by roughly an hour or longer if Google delays a trigger. The interface refreshes countdown/expiry filtering every 30 seconds. `createCleanupTrigger` is idempotent.

Delete asks for confirmation in the interface; the server checks session ownership before removing the row and history refreshes after success. Re-saving after a network timeout uses the same request ID, so retries do not duplicate an unchanged bill. Editing creates a new request ID.

## Tests and real verification

`npm test` runs calculation tests and a simulated Apps Script runtime with in-memory spreadsheet methods. It covers single-person, shared/three-way and quantity splits, service/SST/discounts, repeated cent totals, CRUD, ownership checks, duplicate retries, forged totals, malformed units, formula injection, the exact expiry boundary and trigger deduplication. These tests do not claim to be Google's production infrastructure.

For real verification: create a manual bill → add two friends → assign all units → Calculate & save → verify **Receipt saved to History** → reload → History → View receipt → confirm Delete. Inspect the private database row when saving.

To test expiry without waiting, use an isolated test spreadsheet or a disposable test receipt. Change its `expiresAt` cell to a past ISO timestamp (and the JSON's `expiresAt` for a consistent record); history and details should exclude it. Run `cleanupExpiredReceipts` manually to verify row deletion. Do not edit real users' receipts for tests.

## Structure

```text
src/App.tsx                  Pages, routing and UI flow
src/styles.css               Responsive design
src/types.ts                 Receipt and settlement types
src/services/api.ts          Apps Script HTTP client
src/services/receiptScanner.ts Image reading, real OCR, explicit demo
src/services/sessionService.ts Anonymous session capability
src/utils/billCalculator.ts   Pure calculation functions
google-apps-script/Code.gs    Router, validation, Sheets, cleanup, OCR
tests/                       Calculator and backend regression tests
.github/workflows/deploy.yml GitHub Pages CI/CD
```

## Limits and next improvements

This is a small-group MVP, not a payment processor. Apps Script quotas, a single spreadsheet, linear history reads and a script lock limit throughput. Payload limits are 50 items, 30 participants, at most 500 units and a 45,000-character receipt JSON cell; extremely large bills are rejected clearly. Public anonymous APIs can be abused by generating new sessions; per-session limits are not strong bot protection. OCR is limited to five requests per session per hour as a best-effort cache limit. For larger usage, add real authentication, global spend controls/rate limiting and production telemetry. Avoid enabling paid OCR publicly without budgeting controls.

PWA support uses a manifest for Add to Home Screen. Receipt history needs a network connection; the site does not promise offline history. There is no FastSplit per-session scan cap, but Gemini and Google Apps Script still enforce their own quotas and may reject excess traffic. Test camera and native sharing on physical iPhone/Android devices before claiming full device certification.

Official references: [Vite deployment](https://vite.dev/guide/static-deploy), [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [ContentService redirects](https://developers.google.com/apps-script/guides/content).
