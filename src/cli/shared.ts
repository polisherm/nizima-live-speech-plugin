// 入口どうしで重なる処理。
//
// 打つコマンドは目的ごとに分かれているが、前後の始末はどれも似る。
// 同じ形を各ファイルに書き写すと、直すときに片方だけ残る。

import type { NizimaClient } from "../nizima/client.js";
import type { GetModelsResponse } from "../nizima/types.js";

/**
 * 画面に出ているモデルを並べる。
 *
 * 追加や削除のあとに呼ぶ。狙ったとおりになったかを目で確かめられる。
 */
export async function printModels(client: NizimaClient): Promise<void> {
  const models = await client.request<GetModelsResponse>("GetModels");
  console.log(`\n表示中のモデル: ${models.Models.length} 体`);
  for (const model of models.Models) {
    console.log(`  - ${model.Name ?? "(名前なし)"} [${model.ModelId}]`);
  }
}

/** 標準入力を最後まで読む。 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
