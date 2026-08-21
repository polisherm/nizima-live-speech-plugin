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
import {
  FACE_PARAM_PATTERN,
  resolveEmotion,
  applyEmotion,
  resetEmotion,
} from "../core/emotion.js";
import { readDefaults, readDrift, resolveTarget, wait } from "./shared.js";

const emotionName = process.argv[2] ?? "laugh";

/** 表情が乗りきるまでの待ち時間。FadeInTime は 0.5 秒。 */
const SETTLE_MS = 1200;

/** 戻したあとに値を読む時刻（ミリ秒）。 */
const SAMPLE_AT_MS = [0, 150, 300, 450, 600, 900, 1300];

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[3]);
const defaults = await readDefaults(client, target.modelId);

// 見るのは表情が動かす顔まわりだけ。姿勢と呼吸は常に動く。
// 選ぶ基準は emotion.ts と同じものを使う。書き写すと片方だけずれる。
const watched = FACE_PARAM_PATTERN;

console.log(`対象モデル: ${target.name} (${target.modelId})`);

const mapping = resolveEmotion(target.name, emotionName);
console.log(`感情: ${emotionName} → 表情 ${mapping?.expression ?? "(なし)"}`);

// 1 回目。表情を出したときのずれを基準にする。
await applyEmotion(client, target.modelId, emotionName, target.name);
await wait(SETTLE_MS);
const first = await readDrift(client, target.modelId, defaults, watched);
console.log(
  `\n1. 表情を出した   : ${first.count} 件 / ずれ ${first.total.toFixed(2)}`,
);

// 2 回目。戻す途中を追う。
await resetEmotion(client, target.modelId);
console.log(`\n2. 戻した`);
let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await wait(at - previous);
  previous = at;
  const drift = await readDrift(client, target.modelId, defaults, watched);
  console.log(
    `   ${String(at).padStart(4)}ms  ${String(drift.count).padStart(2)} 件 / ずれ ${drift.total.toFixed(2)}`,
  );
  // 最後まで残ったものは、戻す表情が拾えていない。名前を出す。
  if (at === SAMPLE_AT_MS[SAMPLE_AT_MS.length - 1]) {
    for (const { id, diff } of drift.items) {
      console.log(`           残り: ${id} ${diff.toFixed(3)}`);
    }
  }
}

// 3 回目。戻す表情を出したあとでも、同じ表情が出るか。
await applyEmotion(client, target.modelId, emotionName, target.name);
await wait(SETTLE_MS);
const again = await readDrift(client, target.modelId, defaults, watched);
console.log(
  `\n3. もう一度出した : ${again.count} 件 / ずれ ${again.total.toFixed(2)}`,
);

const ratio = first.total > 0 ? again.total / first.total : 0;
console.log(
  `   1 回目との比: ${(ratio * 100).toFixed(0)}%` +
    (ratio > 0.9 ? "（邪魔していない）" : "（表情が出きっていない）"),
);

await resetEmotion(client, target.modelId);
client.close();
