// モーションを 1 つ再生する。
//
//   npx tsx src/probe/play-motion.ts <モーション名> [モデル名]
//
// 乗り換えの挙動を確かめるのに使う。
import { NizimaClient } from "../nizima/client.js";
import type { GetMotionsResponse } from "../nizima/types.js";
import { resolveTarget } from "./shared.js";

const motionName = process.argv[2];

if (!motionName) {
  console.error("モーション名を渡す");
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[3]);

const motions = await client.request<GetMotionsResponse>("GetMotions", {
  ModelId: target.modelId,
});
const found = motions.Motions.find((m) => m.Name === motionName);
if (!found?.MotionPath) {
  console.error(`モーションが見つからない: ${motionName}`);
  console.error(`ある: ${motions.Motions.map((m) => m.Name).join(", ")}`);
  process.exit(1);
}

await client.request("StartMotion", {
  ModelId: target.modelId,
  MotionPath: found.MotionPath,
});
console.log(`再生: ${target.name} / ${motionName}`);

client.close();
