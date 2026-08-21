// 台詞の読み解きを確かめる。
//
//   npx tsx src/probe/try-parse.ts             つまずいた形をひととおり通す
//   npx tsx src/probe/try-parse.ts "<台詞>"    渡した 1 本だけを見る
//
// 表情の区間・読み上げの単位・字幕と音声のテキストを並べて出す。
// nizima も VOICEVOX も要らない。
//
// 台詞を渡さないときは core/cases.ts を通す。
// 実際につまずいた形を集めてあるので、割り方を変えたあとの見比べに使える。
import { CASES } from "../core/cases.js";
import { EMOTIONS } from "../core/emotion.js";
import {
  parseLine,
  splitParts,
  toSubtitle,
  toReading,
  toReadingWithPause,
} from "../core/line-parser.js";
import { finishReading } from "../core/format-speech.js";

const MAX_CHARS = 44;

const isEmotion = (name: string) => Boolean(EMOTIONS[name]);

const given = process.argv[2];
const cases: Array<[string, string]> = given ? [["渡した台詞", given]] : CASES;

for (const [label, raw] of cases) {
  console.log(`\n########## ${label}`);
  console.log(`入力: ${raw}`);

  const segments = parseLine(raw, isEmotion);

  console.log(`--- 表情の区間`);
  for (const segment of segments) {
    console.log(`  [${segment.emotion}] ${toSubtitle(segment.parts).trim()}`);
  }

  console.log(`--- 読み上げの単位（上限 ${MAX_CHARS} 文字）`);
  for (const segment of segments) {
    for (const group of splitParts(segment.parts, MAX_CHARS)) {
      console.log(`  [${segment.emotion}]`);
      console.log(`    字幕: ${toSubtitle(group).trim()}`);
      console.log(`    音声: ${finishReading(toReading(group))}`);
      console.log(
        `    区切りを残した形: ${finishReading(toReadingWithPause(group))}`,
      );
    }
  }
}
