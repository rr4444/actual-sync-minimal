FROM node:20-alpine AS builder
RUN apk add --no-cache git && git config --global --add safe.directory '*'
WORKDIR /app
RUN npm install -g pnpm@10.25.0

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile

COPY . .
ARG COMMIT_HASH
ENV GIT_COMMIT_HASH=$COMMIT_HASH
RUN pnpm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/actual-sync ./actual-sync
RUN addgroup -g 1001 -S nodejs && \
    adduser -S actual-sync -u 1001
RUN chown -R actual-sync:nodejs /app
USER actual-sync
RUN chmod +x actual-sync
ENTRYPOINT ["./actual-sync"]
CMD ["--help"]