import { NizimaClient } from "../core/nizima-client.js";
import type { GetCurrentModelIdResponse } from "../core/nizima-types.js";
import { formatForSpeech } from "../core/format-speech.js";
import { speakOnModel, closeAudioPlayer } from "../core/speak-core.js";
import { readStdin } from "./shared.js";

/**
 * テキストを VOICEVOX で合成し、再生しながらモデルの口を動かす。
 *
 * 使い方:
 *   npx tsx src/cli/speak.ts "<text>" [speakerId] [expressionName]
 *   echo "<markdown>" | npx tsx src/cli/speak.ts --stdin --format [speakerId] [expressionName]
 *
 * --stdin  テキストを標準入力から読む
 * --format Markdown を読み上げ向けに整形する（既定はオフ。素のテキストをそのまま喋る）
 *
 * 再生の中身は speak-core.ts にある。ここは CLI の入口。
 * 掛け合いは cast.ts が同じ関数を使う。
 */

const args = process.argv.slice(2);
const useStdin = args.includes("--stdin");
const useFormat = args.includes("--format");

// --stdin のときはテキストが標準入力から来るので、位置引数が1つ前へずれる。
const positional = args.filter((arg) => !arg.startsWith("--"));
const rawText = useStdin ? await readStdin() : positional[0];
const speakerId = Number.parseInt(
  positional[useStdin ? 0 : 1] ?? "45", // 45 = 櫻歌ミコ ロリ
  10,
);
const expressionName = positional[useStdin ? 1 : 2];

if (!rawText || !rawText.trim()) {
  console.error(
    'usage: speak.ts "<text>" [speakerId] [expressionName]\n' +
      "       speak.ts --stdin [--format] [speakerId] [expressionName]",
  );
  process.exit(1);
}

const text = useFormat ? formatForSpeech(rawText) : rawText;

if (!text.trim()) {
  console.error("整形の結果、読み上げるテキストが残らなかった");
  process.exit(1);
}

if (useFormat) {
  console.log(`整形後: ${text}`);
}

console.log(`VOICEVOX で合成中 (speaker=${speakerId})...`);

const client = new NizimaClient();
await client.connect();

const current =
  await client.request<GetCurrentModelIdResponse>("GetCurrentModelId");

if (expressionName) {
  console.log(`表情: ${expressionName}`);
}

const result = await speakOnModel(client, {
  text,
  modelId: current.ModelId,
  speakerId,
  expressionName,
});

console.log(`合成完了: ${result.durationSec.toFixed(1)} 秒`);
console.log(
  `再生完了 (口パク送信 成功 ${result.mouthOk} / 失敗 ${result.mouthFailed})`,
);
closeAudioPlayer();
client.close();
