FROM python:3.12-slim-bookworm AS cpu

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/models/home \
    HF_HOME=/models/cache/huggingface \
    XDG_CACHE_HOME=/models/cache \
    SUMMYZ_MODEL_DIR=/models/managed

WORKDIR /service
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt
COPY execution_policy.py language.py model_capability.py server.py structured_logging.py transcription_options.py ./
RUN mkdir -p /models/cache/huggingface /models/home /models/managed /tmp/summyz-audio && \
    chown -R nobody:nogroup /models /tmp/summyz-audio /service

USER nobody
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

FROM nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04 AS cuda

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/models/home \
    HF_HOME=/models/cache/huggingface \
    XDG_CACHE_HOME=/models/cache \
    SUMMYZ_MODEL_DIR=/models/managed

RUN apt-get update && \
    apt-get install --yes --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --requirement requirements.txt
COPY execution_policy.py language.py model_capability.py server.py structured_logging.py transcription_options.py ./
RUN mkdir -p /models/cache/huggingface /models/home /models/managed /tmp/summyz-audio && \
    chown -R nobody:nogroup /models /tmp/summyz-audio /service

USER nobody
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
