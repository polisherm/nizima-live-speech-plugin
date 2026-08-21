// 指定したモデルを現在のシーンに追加する。
// SceneId を渡さないと新規ウィンドウで開くため、必ず現在のシーンを指定する。
//
// 使い方: npx tsx src/cli/scene/add-model.ts "<model3.json のパス>"
import { NizimaClient } from "../../nizima/client.js";
import type {
  AddModelResponse,
  GetCurrentSceneIdResponse,
} from "../../nizima/types.js";
import { printModels } from "../shared.js";

const modelPath = process.argv[2];
if (!modelPath) {
  console.error('usage: add-model.ts "<path to model3.json>"');
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

const scene =
  await client.request<GetCurrentSceneIdResponse>("GetCurrentSceneId");
console.log(`追加先のシーン: ${scene.SceneId}`);

const added = await client.request<AddModelResponse>("AddModel", {
  SceneId: scene.SceneId,
  ModelPath: modelPath,
});
console.log(`追加した ModelId: ${added.ModelId}`);

await printModels(client);

client.close();
