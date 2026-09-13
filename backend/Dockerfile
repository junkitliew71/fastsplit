FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PADDLEOCR_HOME=/opt/paddleocr

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# Download the primary OCR models into the image so the first request does not wait for them.
RUN python -c "from ocr.paddle_ocr import engine; engine()"

RUN useradd --create-home --uid 10001 fastsplit \
    && chown -R fastsplit:fastsplit /app /opt/paddleocr
USER fastsplit

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
