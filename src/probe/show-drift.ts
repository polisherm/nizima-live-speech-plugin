// いま既定値からずれているパラメータを並べる。
//
//   npx tsx src/probe/show-drift.ts [モデル名]
//
// モーションや表情が動かしたまま残っている値を見るのに使う。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveModelIds } from "../core/speak-core.js";

const modelName = process.argv[2] ?? "zundamon_talk";

const client = new NizimaClient();
await client.connect();

const modelId = (await resolveModelIds(client)).get(modelName);
if (!modelId) {
  console.error(`モデルが見つからない: ${modelName}`);
  process.exit(1);
}

const defs = (await client.request("GetCubismParameters", {
  ModelId: modelId,
})) as { CubismParameters?: Array<{ Id: string; DefaultValue: number }> };
const base = new Map(
  (defs.CubismParameters ?? []).map((p) => [p.Id, p.DefaultValue]),
);

const values = (await client.request("GetCubismParameterValues", {
  ModelId: modelId,
})) as { CubismParameterValues?: Array<{ Id: string; Value: number }> };

console.log(`${modelName} で既定からずれている値:`);
for (const p of values.CubismParameterValues ?? []) {
  const b = base.get(p.Id);
  if (b === undefined) continue;
  if (Math.abs(p.Value - b) <= 0.01) continue;
  console.log(`   ${p.Id.padEnd(22)} 既定 ${b} → ${p.Value.toFixed(2)}`);
}

client.close();
