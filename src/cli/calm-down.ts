// 動きっぱなしになったモデルを落ち着かせる。
//
//   npx tsx src/cli/calm-down.ts [モデル名...]
//
// モーションを止め、表情を素へ戻し、口を閉じる。
// モデル名を省くと、画面に出ているものすべてを対象にする。
//
// モーションは止めるまで動き続ける。口を含むモーションが残ると、
// 何も喋っていないのに口が開閉する。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveModelIds } from "../core/speak-core.js";
import { resetEmotion, returnToIdle } from "../core/emotion.js";

const client = new NizimaClient();
await client.connect();

const models = (await client.request("GetModels")) as {
  Models: Array<{ ModelId: string; Name?: string }>;
};

const wanted = process.argv.slice(2);
const ids = await resolveModelIds(client);
const targets = wanted.length
  ? wanted.map((name) => ids.get(name)).filter(Boolean)
  : models.Models.map((m) => m.ModelId);

for (const modelId of targets as string[]) {
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
