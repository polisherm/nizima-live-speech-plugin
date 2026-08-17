// 台詞の読み解きを確かめる確認用スクリプト。
//
//   npx tsx src/probe/try-parse.ts ["<台詞>"]
//
// 表情の区間・読み上げの単位・字幕と音声のテキストを並べて出す。
// nizima も VOICEVOX も要らない。
import { EMOTIONS } from "../core/emotion.js";
import {
  parseLine,
  splitParts,
  toSubtitle,
  toReading,
  toReadingWithPause,
} from "../core/line-parser.js";
import { finishReading } from "../core/format-speech.js";

const SAMPLE =
  "[surprise] えっ、/ {朝型|アサガタ}のほうが得なのだ？" +
  "[think] でもボクは、/ 日が落ちると{瞼|マブタ}が重いのだ。" +
  "[laugh] つまりボクは『夜型――ナイトウォーカー――』なのだ！";

const raw = process.argv[2] ?? SAMPLE;
const MAX_CHARS = 44;

const isEmotion = (name: string) => Boolean(EMOTIONS[name]);

console.log(`入力: ${raw}`);

const segments = parseLine(raw, isEmotion);

console.log(`\n--- 表情の区間`);
for (const segment of segments) {
  console.log(`  [${segment.emotion}] ${toSubtitle(segment.parts).trim()}`);
}

console.log(`\n--- 読み上げの単位（上限 ${MAX_CHARS} 文字）`);
for (const segment of segments) {
  for (const group of splitParts(segment.parts, MAX_CHARS)) {
    console.log(`  [${segment.emotion}]`);
    console.log(`    字幕: ${toSubtitle(group).trim()}`);
    console.log(`    音声: ${finishReading(toReading(group))}`);
    console.log(`    区切りを残した形: ${finishReading(toReadingWithPause(group))}`);
  }
}
