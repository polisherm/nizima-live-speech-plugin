// 表情を止めたあと、パラメータが既定値へ戻るかを時間を追って見る。
//
//   npx tsx src/probe/probe-fade.ts <感情名> [モデル名]
//   例: npx tsx src/probe/probe-fade.ts laugh shikoku_metan_talk
//
// 表情を出し、StopAllExpressions を呼び、そのあとの値を一定間隔で読む。
// 既定値と違うものだけを出す。空行が続けば戻ったことになる。
// 値が段階的に減れば FadeOutTime が効いている。一段で消えれば効いていない。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveEmotion, resetEmotion } from "../core/emotion.js";
import { resolveModelIds } from "../core/speak-core.js";

const emotionName = process.argv[2] ?? "laugh";
const modelName = process.argv[3];

/** 表情を出したまま保つ時間。フェードインを終わらせてから止める。 */
const HOLD_MS = 1500;

/** 止めたあとに値を読む時刻（ミリ秒）。FadeOutTime は 0.5 秒。 */
const SAMPLE_AT_MS = [0, 100, 200, 300, 400, 500, 700, 1000, 1500];

const client = new NizimaClient();
await client.connect();

let modelId: string;
let resolvedName = modelName ?? "(current)";
if (modelName) {
  const ids = await resolveModelIds(client);
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
  const ids = await resolveModelIds(client);
  for (const [name, id] of ids) {
    if (id === modelId) resolvedName = name;
  }
}

// 既定値を控える。ここからのずれが「表情が残っている量」になる。
const defs = (await client.request("GetCubismParameters", {
  ModelId: modelId,
})) as { CubismParameters?: Array<{ Id: string; DefaultValue: number }> };
const defaults = new Map(
  (defs.CubismParameters ?? []).map((p) => [p.Id, p.DefaultValue]),
);

const readDrift = async (): Promise<Array<[string, number]>> => {
  const values = (await client.request("GetCubismParameterValues", {
    ModelId: modelId,
  })) as { CubismParameterValues?: Array<{ Id: string; Value: number }> };
  const drift: Array<[string, number]> = [];
  for (const p of values.CubismParameterValues ?? []) {
    const base = defaults.get(p.Id);
    if (base === undefined) continue;
    if (Math.abs(p.Value - base) > 0.01) drift.push([p.Id, p.Value - base]);
  }
  return drift;
};

console.log(`対象モデル: ${resolvedName} (${modelId})`);

await resetEmotion(client, modelId);
await new Promise((resolve) => setTimeout(resolve, 600));

const mapping = resolveEmotion(resolvedName, emotionName);
if (!mapping?.expression) {
  console.error(`この感情に表情が割り当てられていない: ${emotionName}`);
  process.exit(1);
}

const expressions = (await client.request("GetExpressions", {
  ModelId: modelId,
})) as { Expressions: Array<{ Name: string; ExpressionPath: string }> };
const found = expressions.Expressions.find(
  (e) => e.Name === mapping.expression,
);
if (!found) {
  console.error(`表情が見つからない: ${mapping.expression}`);
  process.exit(1);
}

await client.request("StartExpression", {
  ModelId: modelId,
  ExpressionPath: found.ExpressionPath,
});
console.log(`表情を再生: ${mapping.expression}`);

await new Promise((resolve) => setTimeout(resolve, HOLD_MS));

const held = await readDrift();
console.log(`\n止める直前のずれ: ${held.length} 件`);
for (const [id, diff] of held) console.log(`  ${id} ${diff.toFixed(3)}`);

await client.request("StopAllExpressions", { ModelId: modelId });
console.log(`\nStopAllExpressions を呼んだ。ここから追う。`);

let previous = 0;
for (const at of SAMPLE_AT_MS) {
  await new Promise((resolve) => setTimeout(resolve, at - previous));
  previous = at;
  const drift = await readDrift();
  const total = drift.reduce((sum, [, diff]) => sum + Math.abs(diff), 0);
  console.log(
    `  ${String(at).padStart(4)}ms  残り ${String(drift.length).padStart(2)} 件  ずれの合計 ${total.toFixed(3)}`,
  );
}

const rest = await readDrift();
if (rest.length > 0) {
  console.log(`\n戻りきらなかったパラメータ:`);
  for (const [id, diff] of rest) console.log(`  ${id} ${diff.toFixed(3)}`);
} else {
  console.log(`\nすべて既定値へ戻った。`);
}

await resetEmotion(client, modelId);
client.close();
