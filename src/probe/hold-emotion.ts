// 感情を 1 つ出して、しばらく保つ。目で確かめる用。
//
//   npx tsx src/probe/hold-emotion.ts <感情名> [モデル名] [秒数]
//
// 議論の中では一瞬で切り替わるため、出ているかどうかを見落とす。
// 止めて見せれば判定できる。
import { NizimaClient } from "../core/nizima-client.js";
import { applyEmotion, resetEmotion, returnToIdle } from "../core/emotion.js";
import { resolveModelIds } from "../core/speak-core.js";

const emotion = process.argv[2] ?? "surprise";
const modelName = process.argv[3] ?? "zundamon_talk";
const seconds = Number(process.argv[4] ?? 5);

const client = new NizimaClient();
await client.connect();

const modelId = (await resolveModelIds(client)).get(modelName);
if (!modelId) {
  console.error(`モデルが見つからない: ${modelName}`);
  process.exit(1);
}

await applyEmotion(client, modelId, emotion, modelName);
console.log(`${modelName} を ${emotion} にした。${seconds} 秒このまま。`);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

await returnToIdle(client, modelId);
await resetEmotion(client, modelId);
console.log("素へ戻した。");

client.close();
