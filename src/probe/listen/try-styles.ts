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
//
// スタイルの一覧は VOICEVOX から取る。手で並べると、増えたときに古いまま残る。
import { synthesize, listSpeakers } from "../../voice/voicevox.js";
import { AudioPlayer } from "../../voice/audio-player.js";
import { MODELS } from "../../perform/models.js";
import { EMOTION_LINES, EMOTION_LINE_NAMES } from "./emotion-lines.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import { wait } from "../shared.js";

/** 聞き比べのあいだに置く間。続けて鳴らすと違いが分からない。 */
const GAP_MS = 700;

const args = process.argv.slice(2);
const useText = args[0] === "--text";
const key = useText ? args[1] : (args[0] ?? "angry");
const castName = (useText ? args[2] : args[1]) ?? "めたん";

const model = MODELS[castName];
if (!model) {
  console.error(
    `知らない相手: ${castName}（${Object.keys(MODELS).join(" / ")}）`,
  );
  process.exit(1);
}

const text = useText ? key : EMOTION_LINES[key]?.[castName];
if (!text) {
  console.error(
    `知らない感情: ${key}（${EMOTION_LINE_NAMES.join(" / ")}）\n` +
      `好きな台詞で聞くなら --text "台詞" を渡す`,
  );
  process.exit(1);
}

// その音源が持つスタイルを引く。名前は models.ts の voiceName で照らす。
const speakers = await listSpeakers();
const speaker = speakers.find((s) => s.name === model.voiceName);
if (!speaker) {
  console.error(`VOICEVOX に音源が無い: ${model.voiceName}`);
  console.error(`ある音源: ${speakers.map((s) => s.name).join(", ")}`);
  process.exit(1);
}
const styles = speaker.styles;

if (!useText) console.log(`感情: ${key}`);
console.log(`台詞: ${text}`);
console.log(`相手: ${castName}（${model.voiceName}）`);
console.log(`\nこれから ${styles.length} 通りを順に鳴らす。`);
for (const [index, style] of styles.entries()) {
  console.log(`  ${index + 1}. ${style.name}（${style.id}）`);
}
console.log("");

const player = new AudioPlayer();

for (const [index, style] of styles.entries()) {
  const wavPath = path.join(tmpdir(), `try-style-${process.pid}-${style.id}.wav`);
  // 番号を声に含める。画面を見なくても、どれを聞いているか分かる。
  const spoken = `${index + 1}ばん。${text}`;
  const result = await synthesize(spoken, style.id, wavPath);
  console.log(
    `▶ ${index + 1}. ${style.name}  （${result.durationSec.toFixed(1)} 秒）`,
  );
  await player.play(wavPath, () => {});
  rmSync(wavPath, { force: true });
  await wait(GAP_MS);
}

console.log("\n聞き終えた。番号で答えてもらえば対応づけに使う。");
player.close();
