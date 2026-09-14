# PaddlePaddle 2.6.x can segfault on the newer glibc shipped by Debian Trixie.
# Pin Bookworm so the native OCR runtime stays on a tested ABI.
FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/fastsplit \
    FASTSPLIT_OCR_ENGINE=rapidocr

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements-render.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
RUN useradd --create-home --uid 10001 fastsplit \
    && chown -R fastsplit:fastsplit /app /home/fastsplit
USER fastsplit
# Warm the configured OCR engine once while building the image.
RUN python -c "from ocr.paddle_ocr import engine; engine()"

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
