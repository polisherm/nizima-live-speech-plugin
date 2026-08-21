// 表情を止めたあと、パラメータが既定値へ戻るかを時間を追って見る。
//
//   npx tsx src/probe/probe-fade.ts <感情名> [モデル名]
//   例: npx tsx src/probe/probe-fade.ts laugh shikoku_metan_talk
//
// 表情を出し、StopAllExpressions を呼び、そのあとの値を一定間隔で読む。
// 既定値と違うものだけを出す。数が減っていけば FadeOutTime が効いている。
// 一段で消えれば効いていない。
import { NizimaClient } from "../core/nizima-client.js";
import type { GetExpressionsResponse } from "../core/nizima-types.js";
import { resolveEmotion, resetEmotion } from "../core/emotion.js";
import { readDefaults, readDrift, resolveTarget, wait } from "./shared.js";

const emotionName = process.argv[2] ?? "laugh";

/** 表情を出したまま保つ時間。フェードインを終わらせてから止める。 */
const HOLD_MS = 1500;

/** 止めたあとに値を読む時刻（ミリ秒）。FadeOutTime は 0.5 秒。 */
const SAMPLE_AT_MS = [0, 100, 200, 300, 400, 500, 700, 1000, 1500];

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[3]);
const defaults = await readDefaults(client, target.modelId);

console.log(`対象モデル: ${target.name} (${target.modelId})`);

await resetEmotion(client, target.modelId);
await wait(600);

const mapping = resolveEmotion(target.name, emotionName);
if (!mapping?.expression) {
  console.error(`この感情に表情が割り当てられていない: ${emotionName}`);
  process.exit(1);
}

const expressions = await client.request<GetExpressionsResponse>(
  "GetExpressions",
  { ModelId: target.modelId },
);
const found = expressions.Expressions.find(
  (e) => e.Name === mapping.expression,
);
if (!found) {
  console.error(`表情が見つからない: ${mapping.expression}`);
  process.exit(1);
}

await client.request("StartExpression", {
  ModelId: target.modelId,
  ExpressionPath: found.ExpressionPath,
});
console.log(`表情を再生: ${mapping.expression}`);

await wait(HOLD_MS);

const held = await readDrift(client, target.modelId, defaults);
console.log(`\n止める直前のずれ: ${held.count} 件`);
for (const { id, diff } of held.items) {
  console.log(`  ${id} ${diff.toFixed(3)}`);
}

await client.request("StopAllExpressions", { ModelId: target.modelId });
console.log(`\nStopAllExpressions を呼んだ。ここから追う。`);

let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await wait(at - previous);
  previous = at;
  const drift = await readDrift(client, target.modelId, defaults);
  console.log(
    `  ${String(at).padStart(4)}ms  残り ${String(drift.count).padStart(2)} 件` +
      `  ずれの合計 ${drift.total.toFixed(3)}`,
  );
}

const rest = await readDrift(client, target.modelId, defaults);
if (rest.count > 0) {
  console.log(`\n戻りきらなかったパラメータ:`);
  for (const { id, diff } of rest.items) {
    console.log(`  ${id} ${diff.toFixed(3)}`);
  }
} else {
  console.log(`\nすべて既定値へ戻った。`);
}

await resetEmotion(client, target.modelId);
client.close();
