FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS ffmpeg-builder

ARG FFMPEG_VERSION=8.1.2
ARG FFMPEG_SHA256=464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c
ARG DEBIAN_SNAPSHOT=20260913T000000Z

RUN sed -i \
      "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g; s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install --yes --no-install-recommends \
      build-essential ca-certificates curl libopus-dev nasm pkg-config xz-utils && \
    rm -rf /var/lib/apt/lists/*
COPY --chmod=0755 docker/ffmpeg/build-lgpl.sh /usr/local/bin/build-ffmpeg-lgpl
RUN /usr/local/bin/build-ffmpeg-lgpl

FROM python:3.12.14-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254 AS python-wheels

ARG DEBIAN_SNAPSHOT=20260913T000000Z
ENV LD_LIBRARY_PATH=/opt/ffmpeg/lib \
    PKG_CONFIG_PATH=/opt/ffmpeg/lib/pkgconfig
RUN sed -i \
      "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g; s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install --yes --no-install-recommends build-essential libopus-dev pkg-config && \
    rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
COPY services/faster-whisper/requirements.txt services/faster-whisper/requirements.lock /requirements/
COPY requirements-ci.lock /requirements/requirements-ci.lock
RUN pip wheel \
      --no-binary=av \
      --require-hashes \
      --requirement /requirements/requirements.lock \
      --wheel-dir /wheels && \
    pip wheel \
      --require-hashes \
      --requirement /requirements/requirements-ci.lock \
      --wheel-dir /ci-wheels

FROM python:3.12.14-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254 AS cpu

ARG DEBIAN_SNAPSHOT=20260913T000000Z
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/models/home \
    HF_HOME=/models/cache/huggingface \
    XDG_CACHE_HOME=/models/cache \
    SUMMYZ_MODEL_DIR=/models/managed \
    LD_LIBRARY_PATH=/opt/ffmpeg/lib

RUN sed -i \
      "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g; s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get upgrade --yes --no-install-recommends && \
    apt-get install --yes --no-install-recommends libopus0 && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
COPY --from=python-wheels /wheels /wheels
COPY services/faster-whisper/requirements.txt ./
RUN pip install --no-cache-dir --no-index --find-links=/wheels --requirement requirements.txt && \
    rm -rf /wheels
COPY services/faster-whisper/execution_policy.py services/faster-whisper/language.py \
  services/faster-whisper/model_capability.py services/faster-whisper/model_inventory.py \
  services/faster-whisper/server.py \
  services/faster-whisper/structured_logging.py services/faster-whisper/transcription_options.py ./
RUN mkdir -p /models/cache/huggingface /models/home /models/managed /tmp/summyz-audio && \
    chown -R nobody:nogroup /models /tmp/summyz-audio /service

USER nobody
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04@sha256:8aef630a54bc5c5146ae5ce68e6af5caa3df0fb690bb91544175c91f307e4356 AS cuda

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/models/home \
    HF_HOME=/models/cache/huggingface \
    XDG_CACHE_HOME=/models/cache \
    SUMMYZ_MODEL_DIR=/models/managed \
    LD_LIBRARY_PATH=/opt/ffmpeg/lib \
    PATH=/opt/venv/bin:${PATH}

RUN set -eu; \
    rm -f /etc/apt/sources.list.d/cuda.list; \
    sed -i \
      "s|http://archive.ubuntu.com/ubuntu/|https://archive.ubuntu.com/ubuntu/|g; s|http://security.ubuntu.com/ubuntu/|https://security.ubuntu.com/ubuntu/|g" \
      /etc/apt/sources.list.d/ubuntu.sources; \
    apt-get \
      -o Acquire::Retries=5 \
      -o Acquire::http::Timeout=60 \
      -o Acquire::https::Timeout=60 \
      -o APT::Update::Error-Mode=any \
      update; \
    apt-get \
      -o Acquire::Retries=5 \
      -o Acquire::http::Timeout=60 \
      -o Acquire::https::Timeout=60 \
      install --yes --no-install-recommends \
        libopus0 \
        python3 \
        python3-pip \
        python3-venv; \
    rm -rf /var/lib/apt/lists/*; \
    python3 -m venv /opt/venv
WORKDIR /service
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
COPY --from=python-wheels /wheels /wheels
COPY services/faster-whisper/requirements.txt ./
RUN pip install --no-cache-dir --no-index --find-links=/wheels --requirement requirements.txt && \
    rm -rf /wheels
COPY services/faster-whisper/execution_policy.py services/faster-whisper/language.py \
  services/faster-whisper/model_capability.py services/faster-whisper/model_inventory.py \
  services/faster-whisper/server.py \
  services/faster-whisper/structured_logging.py services/faster-whisper/transcription_options.py ./
RUN mkdir -p /models/cache/huggingface /models/home /models/managed /tmp/summyz-audio && \
    chown -R nobody:nogroup /models /tmp/summyz-audio /service

USER nobody
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

FROM cpu AS test

USER root
COPY --from=python-wheels /ci-wheels /ci-wheels
COPY requirements-ci.lock /requirements-ci.lock
RUN pip install --no-cache-dir --no-index --find-links=/ci-wheels \
      --require-hashes --requirement /requirements-ci.lock && \
    rm -rf /ci-wheels
WORKDIR /workspace
COPY pyproject.toml ./
COPY services/faster-whisper ./services/faster-whisper
RUN mkdir -p reports && chown -R nobody:nogroup /workspace
CMD ["python", "-m", "pytest", "services/faster-whisper"]
USER nobody
