// ループを切ったモーションが、1 周したあと自然に戻るかを見る。
//
//   npx tsx src/probe/probe-motion-loop.ts [モーション名] [モデル名]
//
// 再生してから長めに追いかけ、パラメータのずれが消えていくかを追う。
// 減っていけばフェードで戻っている。残り続けるなら止めるしかない。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveModelIds } from "../core/speak-core.js";

const motionName = process.argv[2] ?? "mtnFace_surprise";
const modelName = process.argv[3] ?? "zundamon_talk";

/** 再生してから読む時刻（ミリ秒）。モーションの長さを跨いで追う。 */
const SAMPLE_AT_MS = [500, 1500, 2500, 3500, 4000, 4500, 5000, 6000, 7000];

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

const read = async () => {
  const values = (await client.request("GetCubismParameterValues", {
    ModelId: modelId,
  })) as { CubismParameterValues?: Array<{ Id: string; Value: number }> };
  let count = 0;
  let total = 0;
  let eyeType = 0;
  for (const p of values.CubismParameterValues ?? []) {
    if (p.Id === "ParamEyeType2") eyeType = p.Value;
    const base = defaults.get(p.Id);
    if (base === undefined) continue;
    const diff = Math.abs(p.Value - base);
    if (diff > 0.01) {
      count += 1;
      total += diff;
    }
  }
  return { count, total, eyeType };
};

const motions = (await client.request("GetMotions", { ModelId: modelId })) as {
  Motions: Array<{ Name?: string; MotionPath?: string }>;
};
const found = motions.Motions.find((m) => m.Name === motionName);
if (!found?.MotionPath) {
  console.error(`モーションが見つからない: ${motionName}`);
  process.exit(1);
}

console.log(`対象: ${modelName} / ${motionName}`);
await client.request("StartMotion", {
  ModelId: modelId,
  MotionPath: found.MotionPath,
});

let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await new Promise((resolve) => setTimeout(resolve, at - previous));
  previous = at;
  const s = await read();
  console.log(
    `  ${String(at).padStart(5)}ms  ${String(s.count).padStart(3)} 件 / ずれ ${s.total.toFixed(2).padStart(7)} / 目の種類 ${s.eyeType.toFixed(2)}`,
  );
}

client.close();
