// 表示中のモデルを、別のモデルへ差し替える。
//
//   npx tsx src/cli/scene/change-model.ts <ModelId> "<model3.json のパス>"
//
// 位置と大きさが引き継がれるかは差し替えの前後で表示する。
// 引き継がれない場合は、並べ直しが要る。
import "../../fail-clean.js";
import { NizimaClient } from "../../nizima/client.js";
import type { GetModelsResponse, ModelInfo } from "../../nizima/types.js";

const modelId = process.argv[2];
const modelPath = process.argv[3];
if (!modelId || !modelPath) {
  console.error('usage: change-model.ts <ModelId> "<path to model3.json>"');
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

const describe = async (label: string): Promise<ModelInfo | undefined> => {
  const models = await client.request<GetModelsResponse>("GetModels");
  const found = models.Models.find((m) => m.ModelId === modelId);
  if (!found) {
    console.log(`${label}: ModelId ${modelId} が見つからない`);
    return undefined;
  }
  console.log(
    `${label}: ${found.Name} [${found.ModelId}] ` +
      `位置(${found.PositionX}, ${found.PositionY}) 倍率 ${found.Scale} 回転 ${found.Rotation}`,
  );
  console.log(`  ${found.ModelPath}`);
  return found;
};

await describe("差し替え前");

await client.request("ChangeModel", { ModelId: modelId, ModelPath: modelPath });

await describe("差し替え後");

client.close();
