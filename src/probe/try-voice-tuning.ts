// 声の出し方を振って聞き比べる。
//
//   npx tsx src/probe/try-voice-tuning.ts <感情> [軸] [めたん|ずんだもん]
//   npx tsx src/probe/try-voice-tuning.ts angry speed めたん
//   npx tsx src/probe/try-voice-tuning.ts --text "好きな台詞" speed めたん
//
// 話者のスタイルは声質の違いで、感情のために用意されたものではない。
// 合わないものを当てると、別人が喋っているように聞こえる。
//
// 同じ声のまま、速さ・高さ・抑揚を動かせば、気持ちの幅を作れるかもしれない。
// それを確かめるための道具。
//
// 一度に多くを判定しようとすると迷う。軸を 1 つに絞って聞く。
import { synthesize, type VoiceTuning } from "../core/voicevox.js";
import { AudioPlayer } from "../core/audio-player.js";
import { MODELS } from "../core/models.js";
import { EMOTION_LINES, EMOTION_LINE_NAMES } from "./emotion-lines.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

/**
 * 振る値。真ん中が既定になるように並べる。
 *
 * 高さの幅は狭くとる。0.1 を超えると声が壊れて、感情の判定どころではなくなる。
 */
const STEPS: Record<string, Array<[number, string]>> = {
  speed: [
    [0.85, "かなり遅い"],
    [0.93, "やや遅い"],
    [1.0, "既定"],
    [1.08, "やや速い"],
    [1.16, "かなり速い"],
  ],
  pitch: [
    [-0.06, "かなり低い"],
    [-0.03, "やや低い"],
    [0, "既定"],
    [0.03, "やや高い"],
    [0.06, "かなり高い"],
  ],
  intonation: [
    [0.4, "ほぼ平坦"],
    [0.7, "抑えめ"],
    [1.0, "既定"],
    [1.35, "やや強い"],
    [1.7, "かなり強い"],
  ],
};

const AXIS_NAMES = Object.keys(STEPS);

const args = process.argv.slice(2);
const useText = args[0] === "--text";
const key = useText ? args[1] : (args[0] ?? "angry");
const axis = (useText ? args[2] : args[1]) ?? "speed";
const castName = (useText ? args[3] : args[2]) ?? "めたん";

const steps = STEPS[axis];
if (!steps) {
  console.error(`知らない軸: ${axis}（${AXIS_NAMES.join(" / ")}）`);
  process.exit(1);
}

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

/** 軸の名前から、合成に渡す形を作る。 */
function tuningOf(value: number): VoiceTuning {
  if (axis === "speed") return { speed: value };
  if (axis === "pitch") return { pitch: value };
  return { intonation: value };
}

if (!useText) console.log(`感情: ${key}`);
console.log(`台詞: ${text}`);
console.log(`相手: ${castName}（話者 ${model.speakerId}）`);
console.log(`軸: ${axis}`);
console.log(`\nこれから ${steps.length} 通りを順に鳴らす。`);
for (const [index, [value, label]] of steps.entries()) {
  console.log(`  ${index + 1}. ${label}（${value}）`);
}
console.log("");

const player = new AudioPlayer();

for (const [index, [value, label]] of steps.entries()) {
  const wavPath = path.join(tmpdir(), `try-tuning-${process.pid}-${index}.wav`);
  // 番号を声に含める。画面を見なくても、どれを聞いているか分かる。
  const spoken = `${index + 1}ばん。${text}`;
  const result = await synthesize(spoken, model.speakerId, wavPath, {
    tuning: tuningOf(value),
  });
  console.log(
    `▶ ${index + 1}. ${label}  ${value}  （${result.durationSec.toFixed(1)} 秒）`,
  );
  await player.play(wavPath, () => {});
  rmSync(wavPath, { force: true });
  // 続けて鳴らすと違いが分からない。少し置く。
  await new Promise((resolve) => setTimeout(resolve, 700));
}

console.log("\n聞き終えた。番号で答えてもらえば割り当てに使う。");
player.close();
