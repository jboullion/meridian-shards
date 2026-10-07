# The WebSocket-to-TCP gateway (tools/gateway/gateway.ts). Node 24 runs the
# TypeScript directly; ws is its only dependency.
#
# Build context: deploy/.stage (made by `node tools/deploy/stage.ts`).

FROM node:24-slim
WORKDIR /srv/gateway
COPY gateway/ ./
ENV GATEWAY_PORT=8059 \
    BLAKSERV_ADDR=blakserv:5959 \
    GATEWAY_TRUST_PROXY=1 \
    NODE_ENV=production
USER node
EXPOSE 8059
CMD ["node", "gateway.ts"]
