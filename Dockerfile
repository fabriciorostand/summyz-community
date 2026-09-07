FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS ffmpeg-builder

ARG FFMPEG_VERSION=8.1.2
ARG FFMPEG_SHA256=464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c
ARG DEBIAN_SNAPSHOT=20260906T000000Z

RUN sed -i \
      "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g; s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install --yes --no-install-recommends \
      build-essential ca-certificates curl libopus-dev nasm pkg-config xz-utils && \
    rm -rf /var/lib/apt/lists/*
COPY docker/ffmpeg/build-lgpl.sh /usr/local/bin/build-ffmpeg-lgpl
RUN /usr/local/bin/build-ffmpeg-lgpl

FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build

ARG NPM_VERSION=10.9.8
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY web/package.json ./web/package.json
RUN npm install --global "npm@${NPM_VERSION}" && \
    test "$(npm --version)" = "${NPM_VERSION}" && \
    npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM build AS test
ARG DEBIAN_SNAPSHOT=20260906T000000Z
RUN sed -i \
      "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g; s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install --yes --no-install-recommends libopus0 python3 python-is-python3 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
ENV LD_LIBRARY_PATH=/opt/ffmpeg/lib \
    PATH=/opt/ffmpeg/bin:${PATH}
COPY biome.json ./
COPY .gitignore ./
COPY docker ./docker
COPY .github ./.github
COPY tests ./tests
COPY scripts ./scripts
COPY services ./services
COPY Dockerfile .env.example docker-compose.yaml docker-compose.nvidia.yaml docker-compose.amd.yaml summyz-community summyz-community.ps1 ./
COPY vitest.config.ts vitest.ci.config.ts vitest.smoke.config.ts ./
CMD ["npm", "run", "test:smoke:local-ai"]

FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime-base

ARG NPM_VERSION=10.9.8
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY web/package.json ./web/package.json
RUN npm install --global "npm@${NPM_VERSION}" && \
    test "$(npm --version)" = "${NPM_VERSION}" && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/data && chown node:node /app/data

FROM runtime-base AS bot-runtime

ARG DEBIAN_SNAPSHOT=20260906T000000Z
RUN sed -i \
      "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|g; s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|g" \
      /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::Check-Valid-Until=false update && \
    apt-get install --yes --no-install-recommends libopus0 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg
ENV LD_LIBRARY_PATH=/opt/ffmpeg/lib \
    PATH=/opt/ffmpeg/bin:${PATH}
USER node

CMD ["node", "dist/main.js"]

FROM runtime-base AS dashboard-runtime

USER node

CMD ["node", "dist/api/main.js"]
