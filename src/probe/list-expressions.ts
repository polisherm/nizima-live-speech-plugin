// モデルを指定して、nizima が認識している表情の一覧を出す。
//
//   npx tsx src/probe/list-expressions.ts [モデル名] [絞り込み]
//   例: npx tsx src/probe/list-expressions.ts zundamon_talk reset
//
// model3.json に足した表情は、nizima が読み直すまで一覧に出ない。
// 読み直しは同じモデルへの ChangeModel で起こせる。
import { NizimaClient } from "../nizima/client.js";
import type { GetExpressionsResponse } from "../nizima/types.js";
import { resolveTarget } from "./shared.js";

const filter = process.argv[3];

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[2]);

const expressions = await client.request<GetExpressionsResponse>(
  "GetExpressions",
  { ModelId: target.modelId },
);

const list = expressions.Expressions.filter((e) =>
  filter ? e.Name.toLowerCase().includes(filter.toLowerCase()) : true,
);

console.log(`${target.name}: 表情 ${expressions.Expressions.length} 件`);
if (filter) console.log(`「${filter}」に一致: ${list.length} 件`);
for (const e of list) {
  console.log(`  ${e.Name}${e.Active ? "  (再生中)" : ""}`);
}

client.close();
