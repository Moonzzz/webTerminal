# syntax=docker/dockerfile:1

ARG ALPINE_VERSION=3.24
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV npm_config_registry=https://registry.npmmirror.com
ENV npm_config_disturl=https://npmmirror.com/mirrors/node

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.backend.json ./
COPY backend ./backend
COPY shared ./shared
COPY config ./config
COPY frontend ./frontend

RUN npm run build
COPY scripts ./scripts
RUN npm run build:bundle

FROM alpine:${ALPINE_VERSION} AS runner
WORKDIR /app

RUN apk add --no-cache libstdc++ \
    && addgroup -g 1000 -S node \
    && adduser -u 1000 -S -G node node

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /usr/local/bin/node /usr/local/bin/node
COPY --from=builder /usr/local/LICENSE /usr/local/LICENSE
COPY --from=builder --chown=node:node /app/dist/production ./

USER node

EXPOSE 3000

CMD ["node", "dist/backend/server.js"]
