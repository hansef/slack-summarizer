# Build stage
FROM node:20-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# Runtime stage
FROM node:20-alpine

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

# Copy non-compiled assets
COPY src/core/cache/schema.sql ./dist/core/cache/

# Cache directory
RUN mkdir -p /cache && chown node:node /cache

USER node

ENV SLACK_SUMMARIZER_DB_PATH=/cache/slack.db
ENV SLACK_SUMMARIZER_LOG_LEVEL=info

# MCP server runs on stdio
ENTRYPOINT ["node", "dist/mcp/server.js"]
