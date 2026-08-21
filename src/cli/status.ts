// 接続を確かめる。
//
//   npm run status
//
// 現在のモデルと、その表情・モーションを並べる。
// 感情に当てられる素材が揃っているかを見るのに使う。
import { NizimaClient } from "../core/nizima-client.js";
import type {
  GetCurrentModelIdResponse,
  GetExpressionsResponse,
  GetMotionsResponse,
} from "../core/nizima-types.js";
import { printModels } from "./shared.js";

const client = new NizimaClient();

console.log("nizima LIVE に接続中...");
await client.connect();
console.log("接続・認証 OK");

await printModels(client);

const current =
  await client.request<GetCurrentModelIdResponse>("GetCurrentModelId");
console.log(`\n現在のモデル: ${current.ModelId}`);

const expressions = await client.request<GetExpressionsResponse>(
  "GetExpressions",
  { ModelId: current.ModelId },
);
console.log(`\n表情: ${expressions.Expressions.length} 件`);
for (const expression of expressions.Expressions) {
  const active = expression.Active ? " (再生中)" : "";
  console.log(`  - ${expression.Name}${active}`);
  console.log(`      path: ${expression.ExpressionPath}`);
}

const motions = await client.request<GetMotionsResponse>("GetMotions", {
  ModelId: current.ModelId,
});
console.log(`\nモーション: ${motions.Motions.length} 件`);
for (const motion of motions.Motions) {
  console.log(`  - ${motion.Name ?? "(名前なし)"}`);
  console.log(`      path: ${motion.MotionPath ?? "(パスなし)"}`);
}

client.close();
