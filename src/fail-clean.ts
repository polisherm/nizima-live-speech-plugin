// 落ちたときに、スタックトレースを出さず、エラーメッセージだけを出す。
//
// 何もしないと、tsx が案内文のあとにスタックトレースを最後まで並べる。
// 打った人が読みたいのは案内のほうで、次に何をすればいいかはそちらに書いてある。
//
// 中を直すときは要るので、NIZIMA_TRACE=1 で戻せる。
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
