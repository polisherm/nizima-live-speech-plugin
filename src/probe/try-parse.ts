// 台詞の読み解きを確かめる。
//
//   npx tsx src/probe/try-parse.ts             つまずいた形をひととおり通す
//   npx tsx src/probe/try-parse.ts "<台詞>"    渡した 1 本だけを見る
//
// 表情の区間・読み上げの単位・字幕と音声のテキストを並べて出す。
// nizima LIVE も VOICEVOX も要らない。
import {
  parseLine,
  splitParts,
  toSubtitle,
  toReading,
  toReadingWithPause,
} from "../script/line-parser.js";
import { finishReading } from "../script/format-speech.js";

/**
 * 台詞の読み解きで実際につまずいた形。
 *
 * 台詞を渡さずに走らせると、ここを全部通す。
 * 割り方を変えたあとの見比べに使う。
 * 名前は「何を見る例か」が分かるように付ける。
 */
const CASES: Array<[string, string]> = [
  ["ふつうの台詞", "[neutral] 朝ごはんの話ね。/ わたくしは断然、{米|コメ}だわ。"],
  [
    "感情が途中で変わる",
    "[think] 宇宙旅行ね。/ 行けるとしたら、[smile] 土星の環を見たいわ。",
  ],
  ["ルビ芸（横棒 U+2015）", "[point] これが『現実――リアル――』なのよ。"],
  ["ルビ芸（横棒 U+2014）", "[point] あの『白飯——ホワイト・ジャスティス——』ね。"],
  ["二重の波括弧", "[think] みたらしのあの{{甘辛|アマカラ}}のタレ、/ ずるいのだ。"],
  [
    // 難しい字に読みを振ったうえで、語全体にも振ってしまった形。
    // 外側を採る。内側を採ると「天ぷら」と「テンプラ」を続けて読む。
    "入れ子になった読みの指定",
    "[angry] 出来たての{天{麩羅|ぷら}|テンプラ}に{醤油|ショウユ}をかけたのよ。",
  ],
  [
    // 綴りを間違えたタグ。文字として残し、その先のタグは効かせる。
    // 候補から外すと rest が縮まず、以降の表情がすべて読まれなくなる。
    "知らないタグが先にある",
    "[smiel] 知らないタグなの。[smile] こっちは通るわ。[think] これも。",
  ],
  ["ルビの読みに切れ目", "[think] {MotionSync|モーション/シンク}でも分かるわ。"],
  ["ルビの読みに読点", "[think] {揺れ幅|ユレ、ハバ}を欲張ると台無しよ。"],
  [
    "切れ目が先頭に残る形",
    "[surprise] 前の日の夜に。/ [neutral]……それ、期待しすぎだわ。",
  ],
  [
    "句点が無いまま長い",
    "[laugh] 分かるのだ / 夏はボクも溶けそうなのだ / でも冬は固くなるのだ / それも困るのだ",
  ],
  [
    "読点が無いまま長い",
    "[think] {ずんだ|ズンダ}揺らすと変だし固めると死んでるみたいだしどうにもならないから困っているのだ。",
  ],
  ["助詞の読みが変わる並び", "[smile] ボクは/ずんだ餅の/工場を買うのだ。"],
  [
    "長い台詞を読点で割る",
    "[neutral] 揺れものって聞こえはいいけれど、/物理演算の設定を/一つ間違えると、頭の横で髪が暴れ出すのよ。",
  ],
];

const MAX_CHARS = 44;

const given = process.argv[2];
const cases: Array<[string, string]> = given ? [["渡した台詞", given]] : CASES;

for (const [label, raw] of cases) {
  console.log(`\n########## ${label}`);
  console.log(`入力: ${raw}`);

  const segments = parseLine(raw);

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
