// The gateway's arena (tools/gateway/arena.ts) uses our packages (@shards/world and the rest).
// Node runs TypeScript directly, but never from node_modules, so the image keeps copies of them
// beside the gateway (packages/, from tools/deploy/stage.ts) and this points @shards/* there.
//
//   node --import ./register.mjs gateway.ts

import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
