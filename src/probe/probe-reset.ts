// 素の顔へ戻す表情が、狙いどおり働くかを測る。
//
//   npx tsx src/probe/probe-reset.ts [感情名] [モデル名]
//   例: npx tsx src/probe/probe-reset.ts laugh shikoku_metan_talk
//
// 3 段階で見る。
//   1. 表情を出す。既定値からのずれが出る
//   2. 戻す。ずれが段階的に減れば、フェードが効いている
//   3. もう一度同じ表情を出す。ずれが 1 と同じに戻れば、戻す表情が邪魔していない
//
// 3 が要る。戻す表情は Overwrite で値を握るため、次の表情を潰す恐れがある。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveEmotion, applyEmotion, resetEmotion } from "../core/emotion.js";
import { resolveModelIds } from "../core/speak-core.js";

const emotionName = process.argv[2] ?? "laugh";
const modelName = process.argv[3];

/** 表情が乗りきるまでの待ち時間。FadeInTime は 0.5 秒。 */
const SETTLE_MS = 1200;

/** 戻したあとに値を読む時刻（ミリ秒）。 */
const SAMPLE_AT_MS = [0, 150, 300, 450, 600, 900, 1300];

const client = new NizimaClient();
await client.connect();

const ids = await resolveModelIds(client);
let modelId: string;
let resolvedName = modelName ?? "(current)";
if (modelName) {
  const found = ids.get(modelName);
  if (!found) {
    console.error(`モデルが見つからない: ${modelName}`);
    console.error(`画面上のモデル: ${[...ids.keys()].join(", ")}`);
    process.exit(1);
  }
  modelId = found;
} else {
  const current = (await client.request("GetCurrentModelId")) as {
    ModelId: string;
  };
  modelId = current.ModelId;
  for (const [name, id] of ids) if (id === modelId) resolvedName = name;
}

const defs = (await client.request("GetCubismParameters", {
  ModelId: modelId,
})) as { CubismParameters?: Array<{ Id: string; DefaultValue: number }> };
const defaults = new Map(
  (defs.CubismParameters ?? []).map((p) => [p.Id, p.DefaultValue]),
);

/** 表情が動かす顔まわりだけを見る。姿勢と呼吸は常に動くので外す。 */
const WATCHED = /^Param(Eye|Brow|Mouth|Cheek|Tere|Face|Sweat|Pattern|Tongue)/i;

const readDrift = async (): Promise<{
  count: number;
  total: number;
  items: Array<[string, number]>;
}> => {
  const values = (await client.request("GetCubismParameterValues", {
    ModelId: modelId,
  })) as { CubismParameterValues?: Array<{ Id: string; Value: number }> };
  let count = 0;
  let total = 0;
  const items: Array<[string, number]> = [];
  for (const p of values.CubismParameterValues ?? []) {
    if (!WATCHED.test(p.Id)) continue;
    const base = defaults.get(p.Id);
    if (base === undefined) continue;
    const diff = Math.abs(p.Value - base);
    if (diff > 0.01) {
      count += 1;
      total += diff;
      items.push([p.Id, p.Value - base]);
    }
  }
  return { count, total, items };
};

console.log(`対象モデル: ${resolvedName} (${modelId})`);

const mapping = resolveEmotion(resolvedName, emotionName);
console.log(`感情: ${emotionName} → 表情 ${mapping?.expression ?? "(なし)"}`);

// 1 回目。表情を出したときのずれを基準にする。
await applyEmotion(client, modelId, emotionName, resolvedName);
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
const first = await readDrift();
console.log(
  `\n1. 表情を出した   : ${first.count} 件 / ずれ ${first.total.toFixed(2)}`,
);

// 2 回目。戻す途中を追う。
await resetEmotion(client, modelId);
console.log(`\n2. 戻した`);
let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await new Promise((resolve) => setTimeout(resolve, at - previous));
  previous = at;
  const drift = await readDrift();
  console.log(
    `   ${String(at).padStart(4)}ms  ${String(drift.count).padStart(2)} 件 / ずれ ${drift.total.toFixed(2)}`,
  );
  // 最後まで残ったものは、戻す表情が拾えていない。名前を出す。
  if (at === SAMPLE_AT_MS[SAMPLE_AT_MS.length - 1] && drift.items.length > 0) {
    for (const [id, diff] of drift.items) {
      console.log(`           残り: ${id} ${diff.toFixed(3)}`);
    }
  }
}

// 3 回目。戻す表情を出したあとでも、同じ表情が出るか。
await applyEmotion(client, modelId, emotionName, resolvedName);
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
const again = await readDrift();
console.log(
  `\n3. もう一度出した : ${again.count} 件 / ずれ ${again.total.toFixed(2)}`,
);

const ratio = first.total > 0 ? again.total / first.total : 0;
console.log(
  `   1 回目との比: ${(ratio * 100).toFixed(0)}%` +
    (ratio > 0.9 ? "（邪魔していない）" : "（表情が出きっていない）"),
);

await resetEmotion(client, modelId);
client.close();
