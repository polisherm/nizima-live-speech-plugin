// どのモーションが口を動かすかを、感情ごとに一覧にする。
//
//   npx tsx src/probe/scan-motion-mouth.ts [モデル名...]
//
// モーションを再生したまま「口を閉じろ」と送り、ParamMouthOpenY を追う。
// モーションは時間とともに動くため、少し間を置いて何度も読み、いちばん開いた値を見る。
//
// 0 に近ければ口パクが通る。大きいほどモーションが口を握っている。
import { NizimaClient } from "../core/nizima-client.js";
import type {
  GetCubismParameterValuesResponse,
  GetMotionsResponse,
} from "../core/nizima-types.js";
import { EMOTION_NAMES, resolveEmotion, resetEmotion } from "../core/emotion.js";
import { resolveModelIds } from "../core/speak-core.js";
import { wait } from "./shared.js";

/** 1 つのモーションを見る回数と間隔。動きの山を捉えるだけの長さを取る。 */
const SAMPLES = 12;
const SAMPLE_INTERVAL_MS = 200;

const client = new NizimaClient();
await client.connect();

const ids = await resolveModelIds(client);
const targets =
  process.argv.length > 2
    ? process.argv.slice(2).map((name) => [name, ids.get(name)] as const)
    : [...ids.entries()];

for (const [name, modelId] of targets) {
  if (!modelId) {
    console.error(`モデルが見つからない: ${name}`);
    continue;
  }

  console.log(`\n=== ${name} (${modelId})`);
  console.log("感情        モーション          最大の開き  判定");

  for (const emotion of EMOTION_NAMES) {
    const mapping = resolveEmotion(name, emotion);
    if (!mapping?.motion) continue;

    await client.request("StopMotion", { ModelId: modelId }).catch(() => {});
    await resetEmotion(client, modelId);
    await wait(400);

    const motions = await client.request<GetMotionsResponse>("GetMotions", {
      ModelId: modelId,
    });
    const found = motions.Motions.find((m) => m.Name === mapping.motion);
    if (!found?.MotionPath) {
      console.log(`${emotion.padEnd(10)}  ${mapping.motion.padEnd(18)}  （無い）`);
      continue;
    }

    await client.request("StartMotion", {
      ModelId: modelId,
      MotionPath: found.MotionPath,
    });

    let peak = 0;
    for (let i = 0; i < SAMPLES; i++) {
      await client
        .request("SetLiveParameterValues", {
          ModelId: modelId,
          Overwrite: true,
          LiveParameterValues: [{ Id: "MouthOpen", Value: 0 }],
        })
        .catch(() => {});
      await wait(SAMPLE_INTERVAL_MS);

      const values = await client.request<GetCubismParameterValuesResponse>(
        "GetCubismParameterValues",
        { ModelId: modelId },
      );
      const openY = (values.CubismParameterValues ?? []).find(
        (p) => p.Id === "ParamMouthOpenY",
      );
      peak = Math.max(peak, openY?.Value ?? 0);
    }

    const verdict =
      peak < 0.05 ? "口パクが通る"
      : peak < 0.3 ? "少し押される"
      : "モーションが握る";

    console.log(
      `${emotion.padEnd(10)}  ${mapping.motion.padEnd(18)}  ${peak.toFixed(3).padStart(8)}  ${verdict}`,
    );
  }

  await client.request("StopMotion", { ModelId: modelId }).catch(() => {});
  await resetEmotion(client, modelId);
}

console.log("\n完了。");
client.close();
