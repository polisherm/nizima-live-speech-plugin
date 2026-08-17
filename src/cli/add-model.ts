// 指定したモデルを現在のシーンに追加する。
// SceneId を渡さないと新規ウィンドウで開くため、必ず現在のシーンを指定する。
//
// 使い方: npx tsx src/cli/add-model.ts "<model3.json のパス>"
import { NizimaClient } from "../core/nizima-client.js";

const modelPath = process.argv[2];
if (!modelPath) {
  console.error('usage: add-model.ts "<path to model3.json>"');
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

const scene = (await client.request("GetCurrentSceneId")) as { SceneId: string };
console.log(`追加先のシーン: ${scene.SceneId}`);

const added = (await client.request("AddModel", {
  SceneId: scene.SceneId,
  ModelPath: modelPath,
})) as { ModelId: string };
console.log(`追加した ModelId: ${added.ModelId}`);

const models = (await client.request("GetModels")) as {
  Models: Array<{ ModelId: string; Name?: string }>;
};
console.log(`\n表示中のモデル: ${models.Models.length} 体`);
for (const model of models.Models) {
  console.log(`  - ${model.Name ?? "(名前なし)"} [${model.ModelId}]`);
}

client.close();
