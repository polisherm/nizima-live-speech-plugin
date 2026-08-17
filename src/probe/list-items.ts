// 画面に出ているアイテムの位置と大きさを読む。
//
//   npx tsx src/probe/list-items.ts
//
// アイテムは nizima の画面上で手でも動かせる。
// 目で合わせた位置と大きさを、そのまま設定へ写すのに使う。
import { NizimaClient } from "../core/nizima-client.js";

const client = new NizimaClient();
await client.connect();

const scene = (await client.request("GetCurrentSceneId")) as {
  SceneId: string;
};
console.log(`シーン: ${scene.SceneId}\n`);

// 一覧を取る名前が分からないので、ありそうなものを順に試す。
const candidates = ["GetItems", "GetItemList", "GetSceneItems", "GetAllItems"];

let found = false;
for (const method of candidates) {
  try {
    const result = await client.request(method, { SceneId: scene.SceneId });
    console.log(`${method}:`);
    console.log(JSON.stringify(result, null, 2));
    found = true;
    break;
  } catch (error) {
    console.log(
      `${method} は使えない: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (!found) {
  console.log("\nアイテムの一覧を取る方法が見つからなかった。");
}

client.close();
