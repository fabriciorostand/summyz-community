FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/models/home \
    HF_HOME=/models/cache/huggingface \
    XDG_CACHE_HOME=/models/cache \
    SUMMYZ_MODEL_DIR=/models/managed

WORKDIR /service
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt
COPY server.py ./
RUN mkdir -p /models/cache/huggingface /models/home /models/managed /tmp/summyz-audio && \
    chown -R nobody:nogroup /models /tmp/summyz-audio /service

USER nobody
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
