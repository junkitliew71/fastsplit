# Receipt scan flow diagnosis

## Code trace

1. `src/App.tsx`: `choose` validates the file and stores it. The file effect creates a preview URL and revokes it only when the file changes or the component unmounts.
2. Confirm & scan calls `run` (an in-flight guard), then `src/services/receiptScanner.ts:scanReceipt`.
3. `prepareReceiptImage` performs upload compression only for files above 12 MB; no browser OCR runs.
4. The health probe wakes the backend, but is no longer a prerequisite. Exactly one multipart POST is made to `/api/receipt/scan`, field `image`.
5. `backend/main.py:scan` decodes the image, analyses quality, preprocesses, calls `ocr/paddle_ocr.py:recognize`, reconstructs layout, parses and validates. A single enhanced retry is allowed. Models are cached and initialized at startup.
6. `parser/layout.py:reconstruct_layout`, `parser/receipt_parser.py:parse`, and `parser/validation.py:validate_and_repair` interpret geometry and amounts.
7. The backend returns `success`, `imageWidth`, `imageHeight`, `ocrBlocks`, `items`, summary amounts, confidence and warnings. It does NOT return `tokens` or `ocr.tokens`.
8. `scanReceipt` validates the response and converts `ocrBlocks` to frontend `ocrTokens` with bounding boxes and money to integer cents.
9. App stores `scanned` and opens `/map`. `ReceiptMapper` initializes items from the scan and passes tokens to `ReceiptViewer`. Empty extracted items initialize a blank manual-mapping row.
10. `confirmMapping` merges the mapped receipt into a fresh bill, calculates totals and opens `/review`. The preview is retained because this does not change the file. No schema/state mismatch was found in this code path.

## Evidence and changes

The old Tesseract adapter combined every TSV word on a line into one bounding box. This removed price-column positions and prevented selecting individual words for mapping. The adapter now preserves word geometry. OCR text can be present without reliable item extraction: the response now explicitly reports `extractionStatus: needs_manual_mapping` and warns the user. Empty OCR returns 422 rather than success.

Health failures previously prevented POST entirely. Network failures and timeouts shared the same message, and successful JSON was trusted without runtime validation. These are now distinguished. OCR subprocess failures expose their exit code and bounded stderr in server logs; English language availability is checked at startup, and subprocess execution has a timeout. Parser errors have a separate code. CPU-heavy image/layout operations run outside the async event loop.

Development frontend logs are enabled only by Vite DEV. Backend stage diagnostics require `FASTSPLIT_DIAGNOSTICS=1`; no images, binary data or receipt text are logged by these diagnostics.

## Deployment versus verification

`render.yaml` and `backend/Dockerfile` select Tesseract; local default remains Paddle. GitHub Pages workflow supplies the configured Render API URL unless overridden by the repository variable. Existing production health responded 200 but did not include an engine field. The new health response includes that field; runtime engine verification requires deployment of this change.

Existing production Review state contains four items, including a wrong Take Away quantity/price. That is evidence of remaining recognition accuracy issues, NOT an end-to-end test of this patch. Local automated tests use mocked OCR for API/error tests and mocked TSV for geometry tests. They do not prove actual Tesseract inference or a production browser upload. Local Tesseract is not installed. Fresh end-to-end production verification remains required before claiming the scanning issue resolved.
