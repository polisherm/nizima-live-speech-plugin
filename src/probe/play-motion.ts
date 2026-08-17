// モーションを 1 つ再生する。
//
//   npx tsx src/probe/play-motion.ts <モーション名> [モデル名]
//
// 乗り換えの挙動を確かめるのに使う。
import { NizimaClient } from "../core/nizima-client.js";
import { resolveModelIds } from "../core/speak-core.js";

const motionName = process.argv[2];
const modelName = process.argv[3] ?? "zundamon_talk";

if (!motionName) {
  console.error("モーション名を渡す");
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

const modelId = (await resolveModelIds(client)).get(modelName);
if (!modelId) {
  console.error(`モデルが見つからない: ${modelName}`);
  process.exit(1);
}

const motions = (await client.request("GetMotions", { ModelId: modelId })) as {
  Motions: Array<{ Name?: string; MotionPath?: string }>;
};
const found = motions.Motions.find((m) => m.Name === motionName);
if (!found?.MotionPath) {
  console.error(`モーションが見つからない: ${motionName}`);
  console.error(`ある: ${motions.Motions.map((m) => m.Name).join(", ")}`);
  process.exit(1);
}

await client.request("StartMotion", {
  ModelId: modelId,
  MotionPath: found.MotionPath,
});
console.log(`再生: ${modelName} / ${motionName}`);

client.close();
