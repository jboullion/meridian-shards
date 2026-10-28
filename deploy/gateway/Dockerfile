# The WebSocket-to-TCP gateway (tools/gateway/gateway.ts), with the arena and its feed.
# Node 24 runs the TypeScript directly; ws is its only dependency, and the arena's packages sit
# beside it (packages/, found through register.mjs).
#
# Build context: deploy/.stage (made by `node tools/deploy/stage.ts`).

FROM node:24-slim
WORKDIR /srv/gateway
COPY gateway/ ./
# The arena's season file (and an arena.json, if one is put there) live in a volume
RUN mkdir -p /srv/gateway/state && chown node:node /srv/gateway/state
ENV GATEWAY_PORT=8059 \
    BLAKSERV_ADDR=blakserv:5959 \
    GATEWAY_TRUST_PROXY=1 \
    ARENA_ASSETS=/srv/gateway/arena-assets \
    ARENA_STATE=/srv/gateway/state/arena-state.json \
    ARENA_CONFIG=/srv/gateway/state/arena.json \
    NODE_ENV=production
USER node
EXPOSE 8059
CMD ["node", "--import", "./register.mjs", "gateway.ts"]
