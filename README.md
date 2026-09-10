# FastSplit

FastSplit is a mobile-first React, TypeScript and Vite app for splitting restaurant bills by what each person ate. It is a static GitHub Pages site backed by Google Apps Script and a private Google Sheet for history only.

## Local receipt OCR

Receipt scanning uses [Tesseract.js](https://github.com/naptha/tesseract.js) wholly in the browser. A receipt image is resized/contrast-adjusted locally, read by a local Web Worker and parsed conservatively into editable items, service charge, SST/tax and discounts. No receipt image, OCR text, API key or AI/OCR request is sent to Apps Script or any third-party OCR service.

The English OCR worker, WASM core and language data live in `public/ocr/`. The service worker caches them with the app shell, so scanning works offline after the app has been opened once and those assets have been cached. The first installation/load needs the site assets to be downloaded. OCR is best with clear English/Latin text; Malaysian receipts with complex layouts, poor photos or other scripts may need manual correction. Always review names, quantities and prices before continuing.

## Offline and sync

Camera capture, upload, local OCR, editing, assignment and calculation do not need a network connection once app assets are cached. If save fails, the completed bill is saved as **Pending Sync** in browser storage with its existing request ID. It is retried when the browser returns online; the server's request-ID idempotency prevents duplicates. Cloud history, cross-device availability and payment/history changes need a connection.

## Google Sheets and Apps Script

`google-apps-script/Code.gs` is deliberately a persistence-only API: `createReceipt`, `history`, `getReceipt` and `deleteReceipt`. Paste it into a standalone Apps Script project, run `setupFastSplit`, then deploy as a Web app running as you and accessible to anyone. Set `VITE_FASTSPLIT_API_URL` to its `/exec` URL in `.env.local` locally or as a GitHub Actions repository variable.

The backend verifies the anonymous `fs_<256-bit random>` session ID on every request and applies that session check server-side for reads and deletes. It reconstructs totals rather than trusting client totals, creates a 72-hour expiry timestamp itself, excludes expired rows immediately, and cleans expired rows hourly. Keep the Sheet private.

## Develop and deploy

```sh
npm install
npm test
npm run build
```

Push `main` to GitHub and select GitHub Actions under Pages. Relative Vite paths and hash routes allow deployment at `https://<user>.github.io/fastsplit/`.

## Verification checklist

1. Upload a clear JPG/PNG/WebP receipt, wait for “Reading receipt locally”, then correct detected entries.
2. Use the phone camera and repeat the flow.
3. Open the installed app once online, then disable the network and scan/edit/calculate a receipt.
4. Complete it offline and confirm the summary says Pending Sync; reconnect and open History to sync it.
5. Use a different browser session and verify it cannot read or delete another session's receipt.
