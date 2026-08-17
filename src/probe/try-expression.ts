// 表情とモーションを1回ずつ再生する動作確認スクリプト。
import { NizimaClient } from "../core/nizima-client.js";

const expressionName = process.argv[2] ?? "exp_laugh";
const motionName = process.argv[3];

const client = new NizimaClient();
await client.connect();

const current = (await client.request("GetCurrentModelId")) as {
  ModelId: string;
};

const expressions = (await client.request("GetExpressions", {
  ModelId: current.ModelId,
})) as { Expressions: Array<{ Name: string; ExpressionPath: string }> };

const expression = expressions.Expressions.find(
  (e) => e.Name === expressionName,
);
if (!expression) {
  console.error(`表情が見つからない: ${expressionName}`);
  process.exit(1);
}

await client.request("StartExpression", {
  ModelId: current.ModelId,
  ExpressionPath: expression.ExpressionPath,
});
console.log(`表情を再生した: ${expressionName}`);

if (motionName) {
  const motions = (await client.request("GetMotions", {
    ModelId: current.ModelId,
  })) as { Motions: Array<{ Name: string; MotionPath: string }> };

  const motion = motions.Motions.find((m) => m.Name === motionName);
  if (motion) {
    await client.request("StartMotion", {
      ModelId: current.ModelId,
      MotionPath: motion.MotionPath,
    });
    console.log(`モーションを再生した: ${motionName}`);
  } else {
    console.error(`モーションが見つからない: ${motionName}`);
  }
}

client.close();
