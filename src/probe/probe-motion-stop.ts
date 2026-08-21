// モーションを止めたとき、姿勢が一段で飛ぶかを見る。
//
//   npx tsx src/probe/probe-motion-stop.ts [感情名] [モデル名]
//
// モーションを再生し、StopMotion を呼び、そのあとの姿勢を追う。
// 値が段階的に戻ればフェードが効いている。一段で消えれば飛んで見える。
import { NizimaClient } from "../nizima/client.js";
import type { GetMotionsResponse } from "../nizima/types.js";
import { resolveEmotion } from "../perform/emotion.js";
import { readDefaults, readDrift, resolveTarget, wait } from "./shared.js";

const emotionName = process.argv[2] ?? "point";

/** モーションが乗りきるまでの待ち時間。 */
const HOLD_MS = 1200;

/** 止めたあとに読む時刻（ミリ秒）。 */
const SAMPLE_AT_MS = [0, 100, 200, 300, 500, 800, 1200];

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[3]);
const defaults = await readDefaults(client, target.modelId);

const mapping = resolveEmotion(target.name, emotionName);
if (!mapping?.motion) {
  console.error(`この感情にモーションが割り当てられていない: ${emotionName}`);
  process.exit(1);
}

const motions = await client.request<GetMotionsResponse>("GetMotions", {
  ModelId: target.modelId,
});
const found = motions.Motions.find((m) => m.Name === mapping.motion);
if (!found?.MotionPath) {
  console.error(`モーションが見つからない: ${mapping.motion}`);
  process.exit(1);
}

console.log(`対象: ${target.name} / ${mapping.motion}`);

await client.request("StartMotion", {
  ModelId: target.modelId,
  MotionPath: found.MotionPath,
});
await wait(HOLD_MS);

const held = await readDrift(client, target.modelId, defaults);
console.log(`\n止める直前: ${held.count} 件 / ずれ ${held.total.toFixed(2)}`);

await client.request("StopMotion", { ModelId: target.modelId });
console.log(`StopMotion を呼んだ。`);

let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await wait(at - previous);
  previous = at;
  const drift = await readDrift(client, target.modelId, defaults);
  console.log(
    `  ${String(at).padStart(4)}ms  ${String(drift.count).padStart(3)} 件 / ずれ ${drift.total.toFixed(2)}`,
  );
}

client.close();
