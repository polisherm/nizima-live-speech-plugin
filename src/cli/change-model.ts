// 表示中のモデルを、別のモデルへ差し替える。
//
//   npx tsx src/cli/change-model.ts <ModelId> "<model3.json のパス>"
//
// 位置と大きさが引き継がれるかは差し替えの前後で表示する。
// 引き継がれない場合は、並べ直しが要る。
import { NizimaClient } from "../core/nizima-client.js";

const modelId = process.argv[2];
const modelPath = process.argv[3];
if (!modelId || !modelPath) {
  console.error('usage: change-model.ts <ModelId> "<path to model3.json>"');
  process.exit(1);
}

interface ModelInfo {
  ModelId: string;
  Name?: string;
  ModelPath?: string;
  PositionX?: number;
  PositionY?: number;
  Scale?: number;
  Rotation?: number;
}

const client = new NizimaClient();
await client.connect();

const describe = async (label: string): Promise<ModelInfo | undefined> => {
  const models = (await client.request("GetModels")) as { Models: ModelInfo[] };
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
