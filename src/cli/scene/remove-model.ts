// 表示中のモデルをシーンから外す。
//
//   npx tsx src/cli/scene/remove-model.ts <ModelId>
//
// 名前ではなく ModelId で指定する。
// 同じ名前のモデルが並ぶことがあり、名前では狙ったほうを外せない。
import "../../fail-clean.js";
import { NizimaClient } from "../../nizima/client.js";
import { printModels } from "../shared.js";

const modelId = process.argv[2];
if (!modelId) {
  console.error("usage: remove-model.ts <ModelId>");
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

await client.request("RemoveModel", { ModelId: modelId });
console.log(`外した: ${modelId}`);

await printModels(client);

client.close();
