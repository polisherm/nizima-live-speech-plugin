// モーションを止めたとき、姿勢が一段で飛ぶかを見る。
//
//   npx tsx src/probe/probe-motion-stop.ts [感情名] [モデル名]
//
// モーションを再生し、StopMotion を呼び、そのあとの姿勢を追う。
// 値が段階的に戻ればフェードが効いている。一段で消えれば飛んで見える。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveEmotion } from "../core/emotion.js";
import { resolveModelIds } from "../core/speak-core.js";

const emotionName = process.argv[2] ?? "point";
const modelName = process.argv[3] ?? "shikoku_metan_talk";

/** モーションが乗りきるまでの待ち時間。 */
const HOLD_MS = 1200;

/** 止めたあとに読む時刻（ミリ秒）。 */
const SAMPLE_AT_MS = [0, 100, 200, 300, 500, 800, 1200];

const client = new NizimaClient();
await client.connect();

const ids = await resolveModelIds(client);
const modelId = ids.get(modelName);
if (!modelId) {
  console.error(`モデルが見つからない: ${modelName}`);
  process.exit(1);
}

const defs = (await client.request("GetCubismParameters", {
  ModelId: modelId,
})) as { CubismParameters?: Array<{ Id: string; DefaultValue: number }> };
const defaults = new Map(
  (defs.CubismParameters ?? []).map((p) => [p.Id, p.DefaultValue]),
);

/** モーションが動かす範囲を見る。体と顔の両方を含める。 */
const readDrift = async (): Promise<{ count: number; total: number }> => {
  const values = (await client.request("GetCubismParameterValues", {
    ModelId: modelId,
  })) as { CubismParameterValues?: Array<{ Id: string; Value: number }> };
  let count = 0;
  let total = 0;
  for (const p of values.CubismParameterValues ?? []) {
    const base = defaults.get(p.Id);
    if (base === undefined) continue;
    const diff = Math.abs(p.Value - base);
    if (diff > 0.01) {
      count += 1;
      total += diff;
    }
  }
  return { count, total };
};

const mapping = resolveEmotion(modelName, emotionName);
if (!mapping?.motion) {
  console.error(`この感情にモーションが割り当てられていない: ${emotionName}`);
  process.exit(1);
}

const motions = (await client.request("GetMotions", {
  ModelId: modelId,
})) as { Motions: Array<{ Name?: string; MotionPath?: string }> };
const found = motions.Motions.find((m) => m.Name === mapping.motion);
if (!found?.MotionPath) {
  console.error(`モーションが見つからない: ${mapping.motion}`);
  process.exit(1);
}

console.log(`対象: ${modelName} / ${mapping.motion}`);

await client.request("StartMotion", {
  ModelId: modelId,
  MotionPath: found.MotionPath,
});
await new Promise((resolve) => setTimeout(resolve, HOLD_MS));

const held = await readDrift();
console.log(`\n止める直前: ${held.count} 件 / ずれ ${held.total.toFixed(2)}`);

await client.request("StopMotion", { ModelId: modelId });
console.log(`StopMotion を呼んだ。`);

let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await new Promise((resolve) => setTimeout(resolve, at - previous));
  previous = at;
  const drift = await readDrift();
  console.log(
    `  ${String(at).padStart(4)}ms  ${String(drift.count).padStart(3)} 件 / ずれ ${drift.total.toFixed(2)}`,
  );
}

client.close();
