// 画面に出ているアイテムの位置と大きさを読む。
//
//   npx tsx src/probe/list-items.ts
//
// アイテムは nizima の画面上で手でも動かせる。
// 目で合わせた位置と大きさを、そのまま設定へ写すのに使う。
import { NizimaClient } from "../core/nizima-client.js";
import type {
  GetCurrentSceneIdResponse,
  GetItemsResponse,
} from "../core/nizima-types.js";

const client = new NizimaClient();
await client.connect();

const scene =
  await client.request<GetCurrentSceneIdResponse>("GetCurrentSceneId");
console.log(`シーン: ${scene.SceneId}\n`);

const result = await client.request<GetItemsResponse>("GetItems", {
  SceneId: scene.SceneId,
});
const items = result.Items ?? [];

console.log(`アイテム: ${items.length} 件`);
for (const item of items) {
  console.log(`  - ${item.ItemId}`);
  console.log(`      ${item.ItemPath ?? "(パスなし)"}`);
}

client.close();
