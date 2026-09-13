# FastSplit

FastSplit is a mobile-first React application for splitting restaurant bills. Receipt recognition is self-hosted: the browser uploads a receipt to the FastAPI service, where PaddleOCR reads it and the server reconstructs rows and parses charges before returning bounding boxes and editable items.

## Architecture

```text
Browser (capture, upload, mapping UI)
  -> FastAPI /api/receipt/scan
  -> image-quality analysis -> adaptive preparation -> cached PaddleOCR
  -> geometric row/column reconstruction -> item-price matching
  -> receipt parser -> mathematical validation/recovery -> confidence and warnings
  -> structured JSON + OCR bounding boxes
```

The frontend performs only lightweight compression for images over 12 MB. It does not load OCR models, browser Python, TensorFlow, ONNX OCR, PaddleOCR, or Tesseract. The API keeps receipt images in memory for the request only; it does not persist them.

The backend now evaluates blur, resolution, exposure, darkness, contrast and shadows before OCR. Preprocessing is adaptive and geometry-preserving, OCR retains polygons and box centers, and layout reconstruction infers quantity/unit/total columns from repeated X positions. Parsing handles multi-line item names and Malaysian summary terms, then mathematical validation checks the item subtotal and printed grand total. Low-confidence results return structured warnings for the mapping UI.

Every successful scan includes a `debug` object with raw OCR, blocks, reconstructed rows, detected columns, parser output, validation output, image-quality metrics and OCR-pass decisions. Expensive enhanced OCR runs only when the normal pass is weak.

The current Phase 1 implementation is deliberately model-compatible: `FASTSPLIT_PRIMARY_OCR` defaults to `PP-OCRv4`, and a supported PaddleOCR model can be selected through the environment after compatibility testing. It keeps per-block polygons, model source, text type and candidate metadata. Handwriting recognition, mixed-region classification and PaddleOCR-VL are later phases; the API currently reports text type as `unknown` instead of pretending that those classifiers exist.

Quantity ambiguity recovery now records both candidates and its reason. Suspicious or mathematically recovered rows are returned with `needsReview`, and the Review screen highlights them until the user edits the row.

## Local development

Start the OCR API (the first run downloads PaddleOCR model files):

```sh
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

In another terminal, run the frontend:

```sh
npm install
# .env.local: VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

Run checks with `npm test` and `npm run build`. The OCR health probe is `GET http://localhost:8000/health`.

Backend regression and accuracy checks:

```sh
cd backend
.venv/Scripts/python -m unittest discover -s tests -v
.venv/Scripts/python evaluate_dataset.py
.venv/Scripts/python evaluate_cord_archive.py "path/to/cord.zip" --output ../debug/cord-evaluation
.venv/Scripts/python evaluate_sroie_archive.py "path/to/sroie.zip" --output ../debug/sroie-evaluation
.venv/Scripts/python evaluate_images.py "path/to/receipt.jpg" --output ../debug/local-image-evaluation.json
```

Human-reviewed samples live in `backend/dataset/`. The evaluator reports item detection, item-price pairing, missing/false item rates, summary-field accuracy and fully correct receipt rate, comparing the saved baseline with the current pipeline.

The external CORD and SROIE reports in `debug/` use their own documented pass definitions. They are regression indicators, not a claim that every receipt in the dataset is fully understood.

## Deployment

GitHub Pages hosts the frontend only. The included `render.yaml` and `backend/Dockerfile` deploy the OCR API as a Render web service with `/health` checks. Render builds from the repository and exposes the FastAPI service over HTTPS. [Deploy this repository to Render](https://render.com/deploy?repo=https://github.com/junkitliew71/fastsplit).

After Render finishes, copy the service's exact `https://...onrender.com` URL into the GitHub repository variable `VITE_API_BASE_URL`, then rerun the **Deploy FastSplit** workflow. The workflow defaults to `https://junkitliew71-fastsplit-ocr.onrender.com` when that exact service name is available.

Deployment variables:

```env
VITE_API_BASE_URL=https://junkitliew71-fastsplit-ocr.onrender.com
VITE_FASTSPLIT_API_URL=https://script.google.com/...  # optional history API
```

`render.yaml` restricts backend CORS to `https://junkitliew71.github.io`. Receipt images remain request-only and are not written to Render's filesystem. Render's free plan is suitable for testing but sleeps when idle; FastSplit performs a health wake-up before uploading the receipt. For production traffic, select a plan with sufficient CPU/RAM.

## Persistence

The existing Google Apps Script integration remains a persistence-only API for completed bill history. It does not receive receipt images or perform OCR.
