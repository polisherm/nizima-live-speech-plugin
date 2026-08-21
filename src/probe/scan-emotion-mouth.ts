// どの表情が口のパラメータを握るかを、全感情ぶん一覧にする。
//
// 表情を出したまま「口を閉じろ」と送り、モデル側の ParamMouthOpenY を読む。
// 0 に近ければ口パクが通る。1 に近ければ表情が握っていて口パクが効かない。
//
//   npx tsx src/probe/scan-emotion-mouth.ts [モデル名...]
//   例: npx tsx src/probe/scan-emotion-mouth.ts zundamon shikoku_metan
//
// モデル名を省くと、画面に出ているモデルをすべて調べる。
import { NizimaClient } from "../nizima/client.js";
import type {
  GetCubismParameterValuesResponse,
  GetExpressionsResponse,
} from "../nizima/types.js";
import { EMOTION_NAMES } from "../script/emotions.js";
import { resolveEmotion, resetEmotion } from "../perform/emotion.js";
import { MOUTH_INTERVAL_MS, resolveModelIds } from "../perform/speak.js";
import { wait } from "./shared.js";

/** 表情が乗りきるまでの待ち時間。フェードインの途中で読むと値が中途半端になる。 */
const SETTLE_MS = 1500;

/** 口パクと同じ経路で送る回数。実際のループと条件を揃える。 */
const MOUTH_SENDS = 8;

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

  console.log(`\n=== ${name} (${modelId}) ===`);
  console.log("感情        表情              ParamMouthOpenY  判定");

  for (const emotion of EMOTION_NAMES) {
    const mapping = resolveEmotion(name, emotion);

    await resetEmotion(client, modelId);
    await wait(400);

    let expressionLabel = "(なし)";
    if (mapping?.expression) {
      const expressions = await client.request<GetExpressionsResponse>(
        "GetExpressions",
        { ModelId: modelId },
      );
      const found = expressions.Expressions.find(
        (e) => e.Name === mapping.expression,
      );
      if (found) {
        await client.request("StartExpression", {
          ModelId: modelId,
          ExpressionPath: found.ExpressionPath,
        });
        expressionLabel = mapping.expression;
      } else {
        expressionLabel = `${mapping.expression}(無)`;
      }
    }

    await wait(SETTLE_MS);

    // 口を閉じろと送り続ける。表情が握っていなければ 0 に落ちる。
    for (let i = 0; i < MOUTH_SENDS; i++) {
      await client
        .request("SetLiveParameterValues", {
          ModelId: modelId,
          Overwrite: true,
          LiveParameterValues: [{ Id: "MouthOpen", Value: 0 }],
        })
        .catch(() => {});
      await wait(MOUTH_INTERVAL_MS);
    }

    const values = await client.request<GetCubismParameterValuesResponse>(
      "GetCubismParameterValues",
      { ModelId: modelId },
    );
    const openY = (values.CubismParameterValues ?? []).find(
      (p) => p.Id === "ParamMouthOpenY",
    );
    const actual = openY?.Value ?? Number.NaN;

    const verdict =
      Number.isNaN(actual) ? "不明"
      : actual < 0.1 ? "口パクが通る"
      : actual > 0.5 ? "表情が握る"
      : "一部だけ通る";

    console.log(
      `${emotion.padEnd(10)}  ${expressionLabel.padEnd(16)}  ${actual.toFixed(3).padStart(7)}          ${verdict}`,
    );
  }

  await resetEmotion(client, modelId);
}

console.log("\n完了。");
client.close();
