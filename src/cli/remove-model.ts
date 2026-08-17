// 表示中のモデルをシーンから外す。
//
//   npx tsx src/cli/remove-model.ts <ModelId>
//
// 名前ではなく ModelId で指定する。
// 同じ名前のモデルが並ぶことがあり、名前では狙ったほうを外せない。
import { NizimaClient } from "../core/nizima-client.js";

const modelId = process.argv[2];
if (!modelId) {
  console.error("usage: remove-model.ts <ModelId>");
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

await client.request("RemoveModel", { ModelId: modelId });
console.log(`外した: ${modelId}`);

const models = (await client.request("GetModels")) as {
  Models: Array<{ ModelId: string; Name?: string }>;
};
console.log(`\n表示中のモデル: ${models.Models.length} 体`);
for (const model of models.Models) {
  console.log(`  - ${model.Name ?? "(名前なし)"} [${model.ModelId}]`);
}

client.close();
