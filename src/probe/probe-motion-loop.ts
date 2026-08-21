// ループを切ったモーションが、1 周したあと自然に戻るかを見る。
//
//   npx tsx src/probe/probe-motion-loop.ts [モーション名] [モデル名]
//
// 再生してから長めに追いかけ、パラメータのずれが消えていくかを追う。
// 減っていけばフェードで戻っている。残り続けるなら止めるしかない。
import { NizimaClient } from "../nizima/client.js";
import type {
  GetCubismParameterValuesResponse,
  GetMotionsResponse,
} from "../nizima/types.js";
import { readDefaults, readDrift, resolveTarget, wait } from "./shared.js";

const motionName = process.argv[2] ?? "mtnFace_surprise";

/** 再生してから読む時刻（ミリ秒）。モーションの長さを跨いで追う。 */
const SAMPLE_AT_MS = [500, 1500, 2500, 3500, 4000, 4500, 5000, 6000, 7000];

/** 目の形。数だけでは見えない切り替わりを、この 1 つで追う。 */
const EYE_TYPE = "ParamEyeType2";

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[3]);
const defaults = await readDefaults(client, target.modelId);

/** 目の形のいまの値。ずれの数には出ない切り替わりを見る。 */
const readEyeType = async (): Promise<number> => {
  const values = await client
    .request<GetCubismParameterValuesResponse>("GetCubismParameterValues", {
      ModelId: target.modelId,
    })
    .catch(() => null);
  return (
    (values?.CubismParameterValues ?? []).find((p) => p.Id === EYE_TYPE)
      ?.Value ?? 0
  );
};

const motions = await client.request<GetMotionsResponse>("GetMotions", {
  ModelId: target.modelId,
});
const found = motions.Motions.find((m) => m.Name === motionName);
if (!found?.MotionPath) {
  console.error(`モーションが見つからない: ${motionName}`);
  process.exit(1);
}

console.log(`対象: ${target.name} / ${motionName}`);
await client.request("StartMotion", {
  ModelId: target.modelId,
  MotionPath: found.MotionPath,
});

let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await wait(at - previous);
  previous = at;
  const drift = await readDrift(client, target.modelId, defaults);
  const eyeType = await readEyeType();
  console.log(
    `  ${String(at).padStart(5)}ms  ${String(drift.count).padStart(3)} 件` +
      ` / ずれ ${drift.total.toFixed(2).padStart(7)}` +
      ` / 目の種類 ${eyeType.toFixed(2)}`,
  );
}

client.close();
