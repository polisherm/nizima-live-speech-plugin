// 感情を 1 つ出して、しばらく保つ。目で確かめる用。
//
//   npx tsx src/probe/hold-emotion.ts <感情名> [モデル名] [秒数]
//
// 議論の中では一瞬で切り替わるため、出ているかどうかを見落とす。
// 止めて見せれば判定できる。
import { NizimaClient } from "../nizima/client.js";
import { applyEmotion, resetEmotion, returnToIdle } from "../perform/emotion.js";
import { resolveTarget, wait } from "./shared.js";

const emotion = process.argv[2] ?? "surprise";
const seconds = Number(process.argv[4] ?? 5);

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[3]);

await applyEmotion(client, target.modelId, emotion, target.name);
console.log(`${target.name} を ${emotion} にした。${seconds} 秒このまま。`);

await wait(seconds * 1000);

await returnToIdle(client, target.modelId);
await resetEmotion(client, target.modelId);
console.log("素へ戻した。");

client.close();
