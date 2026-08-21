// 表情とモーションを 1 回ずつ再生する動作確認スクリプト。
//
//   npx tsx src/probe/try-expression.ts [表情名] [モーション名] [モデル名]
import { NizimaClient } from "../core/nizima-client.js";
import type {
  GetExpressionsResponse,
  GetMotionsResponse,
} from "../core/nizima-types.js";
import { resolveTarget } from "./shared.js";

const expressionName = process.argv[2] ?? "exp_laugh";
const motionName = process.argv[3];

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[4]);

const expressions = await client.request<GetExpressionsResponse>(
  "GetExpressions",
  { ModelId: target.modelId },
);

const expression = expressions.Expressions.find(
  (e) => e.Name === expressionName,
);
if (!expression) {
  console.error(`表情が見つからない: ${expressionName}`);
  process.exit(1);
}

await client.request("StartExpression", {
  ModelId: target.modelId,
  ExpressionPath: expression.ExpressionPath,
});
console.log(`表情を再生した: ${expressionName}`);

if (motionName) {
  const motions = await client.request<GetMotionsResponse>("GetMotions", {
    ModelId: target.modelId,
  });

  const motion = motions.Motions.find((m) => m.Name === motionName);
  if (motion?.MotionPath) {
    await client.request("StartMotion", {
      ModelId: target.modelId,
      MotionPath: motion.MotionPath,
    });
    console.log(`モーションを再生した: ${motionName}`);
  } else {
    console.error(`モーションが見つからない: ${motionName}`);
  }
}

client.close();
