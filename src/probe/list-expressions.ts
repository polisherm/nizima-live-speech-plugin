// モデルを指定して、nizima が認識している表情の一覧を出す。
//
//   npx tsx src/probe/list-expressions.ts [モデル名] [絞り込み]
//   例: npx tsx src/probe/list-expressions.ts zundamon_talk reset
//
// model3.json に足した表情は、nizima が読み直すまで一覧に出ない。
// 読み直しは同じモデルへの ChangeModel で起こせる。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveModelIds } from "../core/speak-core.js";

const modelName = process.argv[2];
const filter = process.argv[3];

const client = new NizimaClient();
await client.connect();

const ids = await resolveModelIds(client);
let modelId: string;
if (modelName) {
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

const expressions = (await client.request("GetExpressions", {
  ModelId: modelId,
})) as { Expressions: Array<{ Name: string; Active?: boolean }> };

const list = expressions.Expressions.filter((e) =>
  filter ? e.Name.toLowerCase().includes(filter.toLowerCase()) : true,
);

console.log(`${modelName ?? modelId}: 表情 ${expressions.Expressions.length} 件`);
if (filter) console.log(`「${filter}」に一致: ${list.length} 件`);
for (const e of list) {
  console.log(`  ${e.Name}${e.Active ? "  (再生中)" : ""}`);
}

client.close();
