// CubismParameter の定義（既定値・上限・下限）を表示する確認用スクリプト。
//
//   npx tsx src/probe/list-cubism-params.ts [モデル名] [絞り込み]
//   例: npx tsx src/probe/list-cubism-params.ts zundamon Mouth
//
// 絞り込みは Id への部分一致。省くと全件出す。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveModelIds } from "../core/speak-core.js";

const modelName = process.argv[2];
const filter = process.argv[3];

const client = new NizimaClient();
await client.connect();

let modelId: string;
if (modelName) {
  const ids = await resolveModelIds(client);
  const found = ids.get(modelName);
  if (!found) {
    console.error(`モデルが見つからない: ${modelName}`);
    console.error(`画面上のモデル: ${[...ids.keys()].join(", ")}`);
    process.exit(1);
  }
  modelId = found;
} else {
  const current = (await client.request("GetCurrentModelId")) as {
    ModelId: string;
  };
  modelId = current.ModelId;
}

const defs = (await client.request("GetCubismParameters", {
  ModelId: modelId,
})) as {
  CubismParameters?: Array<{
    Id: string;
    Name?: string;
    DefaultValue: number;
    Min: number;
    Max: number;
  }>;
};

const params = (defs.CubismParameters ?? []).filter((p) =>
  filter ? p.Id.toLowerCase().includes(filter.toLowerCase()) : true,
);

console.log(`${params.length} 件`);
console.log("Id                      既定      下限      上限");
for (const p of params) {
  console.log(
    `${p.Id.padEnd(22)}  ${String(p.DefaultValue).padStart(6)}  ${String(p.Min).padStart(6)}  ${String(p.Max).padStart(6)}`,
  );
}

client.close();
