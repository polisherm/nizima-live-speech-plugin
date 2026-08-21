// 描画へ渡る字幕の文字列を、そのまま出す。
//
//   npx tsx src/probe/show-subtitle-text.ts "<台詞>"
//
// 画面で省略が起きたとき、渡した文字列そのものを確かめるのに使う。
import { parseLine, splitParts, toSubtitle } from "../script/line-parser.js";
import {
  stripSpacesAroundJapanese,
  stripRubyForSubtitle,
} from "../script/format-speech.js";
import { EMOTIONS } from "../perform/emotion.js";
import { SUBTITLE_MAX_CHARS } from "../stage/subtitle.js";

const raw = process.argv[2];
const speaker = process.argv[3] ?? "めたん";
if (!raw) {
  console.error('usage: show-subtitle-text.ts "<台詞>" [話者名]');
  process.exit(1);
}

const limit = SUBTITLE_MAX_CHARS - (speaker.length + 2);
console.log(`上限 ${limit} 文字（${SUBTITLE_MAX_CHARS} から話者名のぶんを引く）`);

for (const segment of parseLine(raw, (n) => Boolean(EMOTIONS[n]))) {
  for (const group of splitParts(segment.parts, limit)) {
    const cleaned = stripSpacesAroundJapanese(
      stripRubyForSubtitle(toSubtitle(group)),
    );
    const body = `${speaker}: ${cleaned}`;
    console.log(`  ${JSON.stringify(body)}  ${body.length} 文字`);
  }
}
