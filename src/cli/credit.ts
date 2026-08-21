// 声のクレジットを画面に置く。
//
//   npx tsx src/cli/credit.ts        置く
//   npx tsx src/cli/credit.ts --off  消す
//
// 内容は変わらないので、置いたままにする。
// 位置と大きさは nizima の画面で手でも動かせる。動かした結果は保たれる。
// シーンを保存すれば、次に開いたときも残る。
import { NizimaClient } from "../nizima/client.js";
import { showCredit, hideCredit } from "../stage/credit.js";
import { closeSubtitleRenderer } from "../stage/subtitle.js";

const off = process.argv.includes("--off");

const client = new NizimaClient();
await client.connect();

if (off) {
  const removed = await hideCredit(client);
  console.log(removed > 0 ? `消した（${removed} 件）` : "出ていなかった");
} else {
  const added = await showCredit(client);
  console.log(added ? "置いた" : "すでに出ている");
}

closeSubtitleRenderer();
client.close();
