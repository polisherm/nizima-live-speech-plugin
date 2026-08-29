// nizima LIVE に接続して、登録を済ませる。
//
//   npm run connect
//
// 初回はここで登録し、プラグインが有効になるまで待つ。
// 画面に何を出しているかは見ないので、モデルが 1 体も並んでいなくても通る。
//
// モデル・表情・モーションを並べたいときは status.ts を使う。
import "../fail-clean.js";
import { NizimaClient } from "../nizima/client.js";

const client = new NizimaClient();

console.log("nizima LIVE に接続中...");
await client.connect();
console.log("接続・認証 OK");

client.close();
