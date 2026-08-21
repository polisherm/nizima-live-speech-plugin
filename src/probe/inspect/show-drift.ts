// いま既定値からずれているパラメータを並べる。
//
//   npx tsx src/probe/show-drift.ts [モデル名]
//
// モーションや表情が動かしたまま残っている値を見るのに使う。
import { NizimaClient } from "../../nizima/client.js";
import { readDefaults, readDrift, resolveTarget } from "../shared.js";

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[2]);
const defaults = await readDefaults(client, target.modelId);
const drift = await readDrift(client, target.modelId, defaults);

console.log(`${target.name} で既定からずれている値: ${drift.count} 件`);
for (const { id, diff } of drift.items) {
  const base = defaults.get(id) ?? 0;
  console.log(
    `   ${id.padEnd(22)} 既定 ${base} → ${(base + diff).toFixed(2)}`,
  );
}

client.close();
