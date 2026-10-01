FROM python:3.11-slim

# Pasang ffmpeg dan dependensi sistem untuk multimedia & OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Salin dan pasang paket Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Salin seluruh isi proyek
COPY . .

# Buat direktori penyimpanan berkas jika belum ada
RUN mkdir -p uploads outputs web/runtime/cache web/runtime/media

ENV PORT=8000
EXPOSE 8000

# Jalankan server FastAPI dengan membaca port dari environment (otomatis kompatibel dengan Render)
CMD ["sh", "-c", "uvicorn server.py:app --host 0.0.0.0 --port ${PORT:-8000}"]
