import { readFileSync } from "node:fs";
import { parseBgf } from "../packages/formats/src/bgf.ts";
for (const f of process.argv.slice(2)) {
  const b = await parseBgf(new Uint8Array(readFileSync("dist/assets/" + f)));
  console.log(f, "shrink", b.shrink, "groups", JSON.stringify(b.groups));
  b.bitmaps.forEach((m, i) => console.log(" ", i, m.width + "x" + m.height, "off", m.xOffset, m.yOffset, "hs", JSON.stringify(m.hotspots)));
}
