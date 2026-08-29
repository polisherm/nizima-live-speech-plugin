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

/** 引数を分けた結果。 */
export interface ParsedArgs {
  /** `--` で始まらないもの。値を取るフラグの値は入らない。 */
  positional: string[];
  /** そのフラグが渡されたか。 */
  has(flag: string): boolean;
  /** 値を取るフラグの値。渡されていなければ undefined。 */
  value(flag: string): string | undefined;
}

/**
 * コマンドラインの引数を、位置引数とフラグに分ける。
 *
 * フラグは順不同で置ける。位置引数の番号は、フラグを挟んでもずれない。
 * 値を取るフラグは valueFlags に名前を渡す。`--style "..."` のように次の 1 つを読む。
 *
 * 走らせるたびに切り替えるものはフラグで渡す。
 * 環境変数だと、シェルによっては値が残り、次に走らせたときも効いてしまう。
 */
export function parseArgs(argv: string[], valueFlags: string[] = []): ParsedArgs {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    flags.add(arg);
    if (!valueFlags.includes(arg)) continue;

    // 次の 1 つを値として取る。次が無いか、次もフラグなら、値なしとして扱う。
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(arg, next);
      i += 1;
    }
  }

  return {
    positional,
    has: (flag) => flags.has(flag),
    value: (flag) => values.get(flag),
  };
}

/** 標準入力を最後まで読む。 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
