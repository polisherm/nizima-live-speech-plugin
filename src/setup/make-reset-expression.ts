// 表情を素の顔へ戻すための表情ファイルを作る。
//
//   npx tsx src/setup/make-reset-expression.ts [モデル名...]
//   例: npx tsx src/setup/make-reset-expression.ts zundamon_talk shikoku_metan_talk
//
// モデル名を省くと、画面に出ているモデルをすべて対象にする。
//
// 表情はパラメータを Add で加算する。止めても加算が残るものがあり、
// 汗や眉のパターンが顔に残ったままになる。
// パラメータを直接書いて戻すと、表情の FadeOutTime を無視して一段で飛ぶ。
//
// そこで「既定値を Overwrite で指定した表情」を作る。
// 表情として再生するため、戻り方にもフェードがかかる。
import { writeFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { NizimaClient } from "../nizima/client.js";
import type {
  GetCubismParametersResponse,
  GetModelsResponse,
} from "../nizima/types.js";
import { resolveModelIds } from "../perform/speak.js";
import { RESET_EXPRESSION_NAME } from "../perform/emotion.js";

/**
 * 戻す対象から外すパラメータ。
 *
 * 姿勢・体・呼吸・物理は、アイドルモーションや faceFront が動かしている。
 * ここを Overwrite で握ると、表情を戻すたびに体の動きが止まる。
 * 口の開きは口パクが握る。固定すると喋っても口が動かなくなる。
 */
const EXCLUDED = /^Param(Angle|Body|Breath|Physics|Hair|Bust)|^ParamMouthOpenY$/;

const client = new NizimaClient();
await client.connect();

const ids = await resolveModelIds(client);
const models = await client.request<GetModelsResponse>("GetModels");

// 対象は必ず名前で指定させる。
//
// このスクリプトはモデルのフォルダに書き込む。model3.json も書き換える。
// 省略を「全部」と読むと、口パク用に作った複製だけでなく、
// 元のモデルまで書き換わる。取り消す道は無い。
const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  console.error("対象のモデルを名前で指定する。");
  console.error(
    "　例: npx tsx src/setup/make-reset-expression.ts zundamon_talk\n",
  );
  console.error(`画面に出ているモデル: ${[...ids.keys()].join(", ")}`);
  client.close();
  process.exit(1);
}

const targets = wanted.map((name) => ids.get(name)).filter(Boolean);

for (const modelId of targets as string[]) {
  const model = models.Models.find((m) => m.ModelId === modelId);
  const modelPath = model?.ModelPath?.replace(/\\/g, "/");
  if (!modelPath) {
    console.error(`パスが取れない: ${modelId}`);
    continue;
  }

  const modelDir = path.dirname(modelPath);
  const folder = path.basename(modelDir);
  console.log(`\n=== ${folder}`);

  // 表情が触るパラメータを集める。
  const motionDir = path.join(modelDir, "motion");
  const touched = new Set<string>();
  let scanned = 0;
  for (const file of readdirSync(motionDir)) {
    if (!file.endsWith(".exp3.json")) continue;
    if (file === `${RESET_EXPRESSION_NAME}.exp3.json`) continue;
    const data = JSON.parse(readFileSync(path.join(motionDir, file), "utf-8"));
    for (const p of data.Parameters ?? []) {
      if (typeof p.Id === "string") touched.add(p.Id);
    }
    scanned += 1;
  }
  console.log(`  表情 ${scanned} 件から ${touched.size} 個のパラメータを集めた`);

  // 既定値はモデルから引く。推測しない。
  const defs = await client.request<GetCubismParametersResponse>(
    "GetCubismParameters",
    { ModelId: modelId },
  );
  const defaults = new Map(
    (defs.CubismParameters ?? []).map((p) => [p.Id, p.DefaultValue]),
  );

  const parameters = [...touched]
    .filter((id) => !EXCLUDED.test(id))
    .filter((id) => defaults.has(id))
    .sort()
    .map((id) => ({
      Id: id,
      Value: defaults.get(id)!,
      Blend: "Overwrite",
    }));

  const excluded = [...touched].filter((id) => EXCLUDED.test(id)).sort();
  console.log(`  戻す対象: ${parameters.length} 個`);
  console.log(`  対象から外した: ${excluded.join(", ") || "なし"}`);

  const expression = {
    Type: "Live2D Expression",
    FadeInTime: 0.5,
    FadeOutTime: 0.5,
    Parameters: parameters,
  };
  const expressionFile = `${RESET_EXPRESSION_NAME}.exp3.json`;
  writeFileSync(
    path.join(motionDir, expressionFile),
    JSON.stringify(expression, null, "\t"),
    "utf-8",
  );
  console.log(`  書き出した: motion/${expressionFile}`);

  // model3.json へ登録する。既にあれば触らない。
  const model3 = JSON.parse(readFileSync(modelPath, "utf-8"));
  const expressions = model3.FileReferences.Expressions ?? [];
  if (expressions.some((e: { Name: string }) => e.Name === RESET_EXPRESSION_NAME)) {
    console.log(`  model3.json には登録済み`);
  } else {
    expressions.push({
      Name: RESET_EXPRESSION_NAME,
      File: `motion/${expressionFile}`,
    });
    model3.FileReferences.Expressions = expressions;
    writeFileSync(modelPath, JSON.stringify(model3, null, "\t"), "utf-8");
    console.log(`  model3.json へ登録した（表情 ${expressions.length} 件）`);
  }
}

console.log("\n完了。nizima が読み直すまで反映されないことがある。");
client.close();
