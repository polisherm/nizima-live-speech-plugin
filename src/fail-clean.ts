// 打ったコマンドが落ちたときの終わり方をそろえる。
//
// 何もしないと、tsx が案内文のあとに呼び出しの跡を最後まで出す。
// 打った人が読みたいのは最初の一行で、跡はそこから何をすればいいかを教えない。
//
// 跡が要るのは中を直すときなので、NIZIMA_TRACE=1 で戻せるようにする。
//
// 読み込むだけで効く。入口のファイルは top-level await で書いてあり、
// 全体を try で囲むと、中身のインデントがまるごとひとつ深くなる。
//
// 置き場は config.ts と同じ直下。cli も setup も入口で、
// 片方をもう片方の下に置くと、入口どうしが繋がる。

const showTrace = process.env.NIZIMA_TRACE === "1";

function report(error: unknown): never {
  if (showTrace && error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}

process.on("unhandledRejection", report);
process.on("uncaughtException", report);
