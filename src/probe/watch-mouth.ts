// 口パクを送りながら、モデルの口がどうなっているかを読む。
//
//   npx tsx src/probe/watch-mouth.ts <感情> [モデル名] [秒数]
//   npx tsx src/probe/watch-mouth.ts angry zundamon_talk 10
//
// probe-mouth.ts は値を固定で送る。こちらは本番と同じ波形で揺らす。
// 表情と身振りの出し方も本番と同じ道（applyEmotion）を通す。
//
// 送った値とモデルの値を並べて出す。
// 食い違えば、何かが上書きしている。いつ食い違うかが手がかりになる。
// 身振りの再生中と再生後で通り方が変わるかも、時間の並びから読める。
import { NizimaClient } from "../core/nizima-client.js";
import { applyEmotion, resetEmotion } from "../core/emotion.js";
import { resolveModelIds } from "../core/speak-core.js";

const emotionName = process.argv[2] ?? "angry";
const modelName = process.argv[3] ?? "zundamon_talk";
const seconds = Number.parseFloat(process.argv[4] ?? "10");

/** 口パクの送信間隔。speak-core.ts と揃える。 */
const MOUTH_INTERVAL_MS = 120;

const client = new NizimaClient();
await client.connect();

const ids = await resolveModelIds(client);
const modelId = ids.get(modelName);
if (!modelId) {
  console.error(`モデルが見つからない: ${modelName}`);
  console.error(`画面上のモデル: ${[...ids.keys()].join(", ")}`);
  process.exit(1);
}

console.log(`対象: ${modelName} (${modelId}) / 感情: ${emotionName}`);

// 前の表情を持ち越さない。
await resetEmotion(client, modelId);
await new Promise((resolve) => setTimeout(resolve, 300));

// 本番と同じ道で表情と身振りを出す。
await applyEmotion(client, modelId, emotionName, modelName);

const startedAt = Date.now();
console.log("");
console.log("経過(s)  送った値  読んだ値  差");

let stop = false;
while (!stop) {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed >= seconds) break;

  // speak-core.ts の口パクと同じ式にする。
  const base = Math.abs(Math.sin(elapsed * Math.PI * 3.5));
  const value = 0.15 + base * 0.65;

  await client
    .request("SetLiveParameterValues", {
      ModelId: modelId,
      Overwrite: true,
      LiveParameterValues: [{ Id: "MouthOpen", Value: value }],
    })
    .catch(() => {});

  const values = (await client
    .request("GetCubismParameterValues", { ModelId: modelId })
    .catch(() => null)) as {
    CubismParameterValues?: Array<{ Id: string; Value: number }>;
  } | null;
  const actual = (values?.CubismParameterValues ?? []).find(
    (p) => p.Id === "ParamMouthOpenY",
  )?.Value;

  const shown = actual ?? Number.NaN;
  console.log(
    `${elapsed.toFixed(2).padStart(6)}  ${value.toFixed(3).padStart(8)}` +
      `  ${shown.toFixed(3).padStart(8)}  ${(shown - value).toFixed(3).padStart(7)}`,
  );

  await new Promise((resolve) => setTimeout(resolve, MOUTH_INTERVAL_MS));
}

await client
  .request("SetLiveParameterValues", {
    ModelId: modelId,
    LiveParameterValues: [{ Id: "MouthOpen", Value: 0 }],
  })
  .catch(() => {});
await resetEmotion(client, modelId);
client.close();
