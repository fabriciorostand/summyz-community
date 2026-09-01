FROM node:22-bookworm-slim AS build

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
    apt-get install --yes --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*
COPY tests ./tests
COPY scripts ./scripts
COPY vitest.config.ts vitest.smoke.config.ts ./
CMD ["npm", "run", "test:smoke:local-ai"]

FROM node:22-bookworm-slim AS runtime-base

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
    apt-get install --yes --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*
USER node

CMD ["npm", "start"]

FROM runtime-base AS dashboard-runtime

USER node

CMD ["npm", "run", "start:api"]
