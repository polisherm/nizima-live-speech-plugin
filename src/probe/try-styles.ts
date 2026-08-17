// 感情を 1 つ選び、その台詞をスタイルごとに鳴らして聞き比べる。
//
//   npx tsx src/probe/try-styles.ts <感情> [めたん|ずんだもん]
//   npx tsx src/probe/try-styles.ts --text "好きな台詞" [めたん|ずんだもん]
//
// VOICEVOX の話者は、同じ声でも複数のスタイルを持つ。
// 感情に合わせてスタイルを変えると、声にも気持ちが乗る。
//
// 一度に多くを判定しようとすると迷う。
// 感情を 1 つに絞り、その台詞に声が合うかだけを聞く。
import { synthesize } from "../core/voicevox.js";
import { AudioPlayer } from "../core/audio-player.js";
import { EMOTION_LINES } from "./emotion-lines.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

/** 聞き比べる相手。名前とスタイルの一覧を持つ。 */
const CASTS: Record<string, Array<[number, string]>> = {
  めたん: [
    [2, "ノーマル"],
    [0, "あまあま"],
    [6, "ツンツン"],
    [4, "セクシー"],
    [36, "ささやき"],
  ],
  ずんだもん: [
    [3, "ノーマル"],
    [1, "あまあま"],
    [7, "ツンツン"],
    [5, "セクシー"],
    [75, "ヘロヘロ"],
    [76, "なみだめ"],
  ],
};

/** 感情ごとの台詞。抑揚の聞き比べと同じものを使う。 */
const LINES = EMOTION_LINES;

const args = process.argv.slice(2);
const useText = args[0] === "--text";
const key = useText ? args[1] : (args[0] ?? "angry");
const castName = (useText ? args[2] : args[1]) ?? "めたん";
const styles = CASTS[castName];

if (!styles) {
  console.error(`知らない相手: ${castName}（${Object.keys(CASTS).join(" / ")}）`);
  process.exit(1);
}

const text = useText ? key : LINES[key]?.[castName];
if (!text) {
  console.error(
    `知らない感情: ${key}（${Object.keys(LINES).join(" / ")}）\n` +
      `好きな台詞で聞くなら --text "台詞" を渡す`,
  );
  process.exit(1);
}
if (!useText) console.log(`感情: ${key}`);

console.log(`台詞: ${text}`);
console.log(`相手: ${castName}`);
console.log(`\nこれから ${styles.length} 通りを順に鳴らす。`);
for (const [index, [id, name]] of styles.entries()) {
  console.log(`  ${index + 1}. ${name}（${id}）`);
}
console.log("");

const player = new AudioPlayer();

for (const [index, [id, name]] of styles.entries()) {
  const wavPath = path.join(tmpdir(), `try-style-${process.pid}-${id}.wav`);
  // 番号を声に含める。画面を見なくても、どれを聞いているか分かる。
  const spoken = `${index + 1}ばん。${text}`;
  const result = await synthesize(spoken, id, wavPath);
  console.log(`▶ ${index + 1}. ${name}  （${result.durationSec.toFixed(1)} 秒）`);
  await player.play(wavPath, () => {});
  rmSync(wavPath, { force: true });
  // 続けて鳴らすと違いが分からない。少し置く。
  await new Promise((resolve) => setTimeout(resolve, 700));
}

console.log("\n聞き終えた。番号で答えてもらえば対応づけに使う。");
player.close();
