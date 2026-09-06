FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS ffmpeg-builder

ARG FFMPEG_VERSION=8.1.2
ARG FFMPEG_SHA256=464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c

RUN apt-get update && \
    apt-get install --yes --no-install-recommends \
      build-essential ca-certificates curl libopus-dev nasm pkg-config xz-utils && \
    rm -rf /var/lib/apt/lists/*
COPY docker/ffmpeg/build-lgpl.sh /usr/local/bin/build-ffmpeg-lgpl
RUN /usr/local/bin/build-ffmpeg-lgpl

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY web/package.json ./web/package.json
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM build AS test
RUN apt-get update && \
    apt-get install --yes --no-install-recommends libopus0 python3 python-is-python3 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
ENV LD_LIBRARY_PATH=/opt/ffmpeg/lib \
    PATH=/opt/ffmpeg/bin:${PATH}
COPY biome.json ./
COPY .gitignore ./
COPY docker ./docker
COPY tests ./tests
COPY scripts ./scripts
COPY services ./services
COPY Dockerfile .env.example docker-compose.yaml docker-compose.nvidia.yaml docker-compose.amd.yaml summyz-community summyz-community.ps1 ./
COPY vitest.config.ts vitest.smoke.config.ts ./
CMD ["npm", "run", "test:smoke:local-ai"]

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime-base

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/data && chown node:node /app/data

FROM runtime-base AS bot-runtime

RUN apt-get update && \
    apt-get install --yes --no-install-recommends libopus0 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
ENV LD_LIBRARY_PATH=/opt/ffmpeg/lib \
    PATH=/opt/ffmpeg/bin:${PATH}
USER node

CMD ["npm", "start"]

FROM runtime-base AS dashboard-runtime

USER node

CMD ["npm", "run", "start:api"]
