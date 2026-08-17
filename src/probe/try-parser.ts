// パーサだけを動かして、読み解いた結果を見る。
//
//   npx tsx src/probe/try-parser.ts ["台詞"]
import { parseLine, toDisplay, toReading } from "../core/line-parser.js";
import { EMOTIONS } from "../core/emotion.js";

const isEmotion = (name: string) => Boolean(EMOTIONS[name]);

const given = process.argv[2];
const cases = given
  ? [given]
  : [
      "[point] これが『現実――リアル――』なのよ。",
      "[point] あの『白飯——ホワイト・ジャスティス——』ね。",
      "[think] みたらしのあの{{甘辛|アマカラ}}のタレ、/ ずるいのだ。",
      // 難しい字に読みを振ったうえで、語全体にも振ってしまった形。
      // 外側を採る。内側を採ると「天ぷら」と「テンプラ」を続けて読む。
      "[angry] 出来たての{天{麩羅|ぷら}|テンプラ}に{醤油|ショウユ}をかけたのよ。",
      "[think] {MotionSync|モーション/シンク}でも分かるわ。",
      "[think] {揺れ幅|ユレ、ハバ}を欲張ると台無しよ。",
      "[think] 宇宙旅行ね。/ 行けるとしたら、[smile] 土星の環を見たいわ。",
      "[surprise] 前の日の夜に。/ [neutral]……それ、期待しすぎだわ。",
    ];

for (const raw of cases) {
  console.log(`\n元: ${raw}`);
  for (const segment of parseLine(raw, isEmotion)) {
    console.log(`  [${segment.emotion}]`);
    console.log(`    字幕: ${toDisplay(segment.parts).trim()}`);
    console.log(`    音声: ${toReading(segment.parts).trim()}`);
    console.log(
      `    部品: ${segment.parts.map((p) => p.kind).join(",")}`,
    );
  }
}
