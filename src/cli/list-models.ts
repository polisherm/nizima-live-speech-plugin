// 登録済みモデル・表示中モデル・シーンを一覧する確認用スクリプト。
// 2 体以上を並べるとき、どのモデルをどのシーンに追加できるかを調べる。
import { NizimaClient } from "../core/nizima-client.js";

const client = new NizimaClient();
await client.connect();

const registered = (await client.request("GetRegisteredModels")) as {
  RegisteredModels: Array<{ Name?: string; ModelPath?: string }>;
};
console.log(`登録済みモデル: ${registered.RegisteredModels.length} 件`);
for (const model of registered.RegisteredModels) {
  console.log(`  - ${model.Name ?? "(名前なし)"}`);
  console.log(`      ${model.ModelPath ?? "(パスなし)"}`);
}

const models = (await client.request("GetModels")) as {
  Models: Array<{
    ModelId: string;
    Name?: string;
    ModelPath?: string;
    PositionX?: number;
    PositionY?: number;
    Scale?: number;
  }>;
};
console.log(`\n表示中のモデル: ${models.Models.length} 体`);
for (const model of models.Models) {
  console.log(`  - ${model.Name ?? "(名前なし)"} [${model.ModelId}]`);
  // 同じ Name のモデルが並ぶことがある。見分けにはパスが要る。
  console.log(`      ${model.ModelPath ?? "(パスなし)"}`);
  const x = model.PositionX?.toFixed(3) ?? "?";
  const y = model.PositionY?.toFixed(3) ?? "?";
  console.log(`      位置(${x}, ${y}) 倍率 ${model.Scale?.toFixed(3) ?? "?"}`);
}

const scenes = (await client.request("GetScenes")) as {
  Scenes: Array<{ SceneId?: string; Name?: string }>;
};
console.log(`\nシーン: ${scenes.Scenes.length} 件`);
for (const scene of scenes.Scenes) {
  console.log(`  - ${scene.Name ?? "(名前なし)"} [${scene.SceneId ?? "?"}]`);
}

const current = (await client.request("GetCurrentSceneId")) as {
  SceneId: string;
};
console.log(`\n現在のシーン: ${current.SceneId}`);

client.close();
