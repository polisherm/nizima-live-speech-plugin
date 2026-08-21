// 動きっぱなしになったモデルを落ち着かせる。
//
//   npx tsx src/cli/calm-down.ts [モデル名...]
//
// モーションを止め、表情を素へ戻し、口を閉じる。
// モデル名を省くと、画面に出ているものすべてを対象にする。
//
// モーションは止めるまで動き続ける。口を含むモーションが残ると、
// 何も喋っていないのに口が開閉する。
import { NizimaClient } from "../nizima/client.js";
import type { GetModelsResponse } from "../nizima/types.js";
import { resolveModelIds } from "../perform/speak.js";
import { resetEmotion, returnToIdle } from "../perform/emotion.js";

const client = new NizimaClient();
await client.connect();

const wanted = process.argv.slice(2);
const ids = await resolveModelIds(client);

// 名前を省いたら、画面に出ているものすべてを落ち着かせる。
// 書き込む処理は無いので、まとめて当てて困らない。
const targets: string[] = [];
if (wanted.length > 0) {
  for (const name of wanted) {
    const id = ids.get(name);
    if (id) targets.push(id);
    else console.error(`モデルが見つからない: ${name}`);
  }
} else {
  const models = await client.request<GetModelsResponse>("GetModels");
  targets.push(...models.Models.map((m) => m.ModelId));
}

for (const modelId of targets) {
  // 止めるのではなく待機へ乗り換える。止めると姿勢が一段で飛ぶ。
  await returnToIdle(client, modelId);
  await client
    .request("SetLiveParameterValues", {
      ModelId: modelId,
      LiveParameterValues: [{ Id: "MouthOpen", Value: 0 }],
    })
    .catch(() => {});
  await resetEmotion(client, modelId);
  console.log(`落ち着かせた: ${modelId}`);
}

client.close();
