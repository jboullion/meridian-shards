# The account service (tools/accounts/accounts.ts, docs/adr/0030-account-recovery.md): links an
# email to a game account and resets passwords through it. Node 24 runs the TypeScript directly;
# it has no dependencies. It runs in blakserv's network namespace (docker-compose.yml) to reach
# the maintenance port on 127.0.0.1.
#
# Build context: deploy/.stage (made by `node tools/deploy/stage.ts`).

FROM node:24-slim
WORKDIR /srv/accounts
COPY accounts/ ./
ENV ACCOUNTS_PORT=8060 \
    MAINT_PORT=9998 \
    ACCOUNTS_TRUST_PROXY=1 \
    NODE_ENV=production
USER node
EXPOSE 8060
CMD ["node", "accounts/accounts.ts"]
