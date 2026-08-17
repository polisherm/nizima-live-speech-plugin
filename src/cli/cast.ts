import { readFileSync } from "node:fs";
import { NizimaClient } from "../core/nizima-client.js";
import {
  resolveModelIds,
  closeAudioPlayer,
  faceFront,
  warmUp,
} from "../core/speak-core.js";
import { ROLES } from "../core/roles.js";
import { performLine, prepareLine } from "../core/perform.js";
import type { PreparedSpeech } from "../core/speak-core.js";
import { resetEmotion, returnToIdle } from "../core/emotion.js";
import { Subtitle, closeSubtitleRenderer } from "../core/subtitle.js";

/** 字幕を出すか。0 を渡すと声だけになる。 */
const SUBTITLE_ENABLED = process.env.SUBTITLE !== "0";

/** 字幕に話者名を出すか。 */
const SUBTITLE_WITH_NAME = process.env.SUBTITLE_WITH_NAME !== "0";

/**
 * 台本を読んで、複数のモデルに順番に喋らせる。
 *
 * 使い方:
 *   npx tsx src/cli/cast.ts <台本ファイル>
 *   npx tsx src/cli/cast.ts --stdin
 *
 * 台本の形式は 1 行 1 台詞。
 *   めたん: 今日も金欠なのよ
 *   ずんだもん: またなのだ？
 *
 * 空行と # で始まる行は読み飛ばす。
 */

// 台詞と台詞の間はここで作らない。
//
// 音声の末尾に、文の終わりぶんの無音が既に入っている。
// ここでも待つと足し算になり、掛け合いが間延びする。
// 間の長さは音声側だけが持つ（voicevox.ts の末尾の無音を参照）。

interface Line {
  role: string;
  text: string;
}

function parseScript(source: string): Line[] {
  const lines: Line[] = [];
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const matched = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!matched) {
      console.warn(`役名が読み取れない行を飛ばした: ${line}`);
      continue;
    }
    lines.push({ role: matched[1].trim(), text: matched[2].trim() });
  }
  return lines;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const args = process.argv.slice(2);
const source = args.includes("--stdin")
  ? await readStdin()
  : args[0]
    ? readFileSync(args[0], "utf-8")
    : "";

if (!source.trim()) {
  console.error("usage: cast.ts <台本ファイル>\n       cast.ts --stdin");
  process.exit(1);
}

const script = parseScript(source);
if (script.length === 0) {
  console.error("読み上げる台詞がなかった");
  process.exit(1);
}

// 台本に出てくる役が全部定義されているか、喋り始める前に確かめる。
const unknown = [...new Set(script.map((l) => l.role))].filter(
  (role) => !ROLES[role],
);
if (unknown.length > 0) {
  console.error(
    `定義されていない役: ${unknown.join(", ")}（使えるのは ${Object.keys(ROLES).join(", ")}）`,
  );
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

// モデル名から ModelId を引く。名前が見つからなければ、その場で止める。
const modelIds = await resolveModelIds(client);
console.log("表示中のモデル:");
for (const [name, id] of modelIds) {
  console.log(`  ${name} → ${id}`);
}

const missing = [...new Set(script.map((l) => l.role))].filter(
  (role) => !modelIds.has(ROLES[role].modelName),
);
if (missing.length > 0) {
  console.error(
    `\nモデルが画面に出ていない役: ${missing.join(", ")}\n` +
      "add-model.ts で追加してから実行する",
  );
  client.close();
  process.exit(1);
}

console.log(`\n${script.length} 台詞を再生する\n`);

// 喋り出す前に重い準備を済ませる。台詞の途中で払うと、そこで会話が止まって見える。
const warmUpStartedAt = Date.now();
await warmUp([...new Set(script.map((l) => ROLES[l.role].speakerId))], client);
console.log(`準備を終えた（${Date.now() - warmUpStartedAt}ms）\n`);

const subtitle = SUBTITLE_ENABLED ? new Subtitle(client) : null;

// 顔をこちらへ向け続ける。放っておくと少しずつ横を向く。
//
// FACE_FRONT=0 で止められる。
// 向きも口も同じ API へ送るため、片方がもう片方を打ち消していないかを
// 切り分けるのに使う。
const posture = setInterval(() => {
  if (process.env.FACE_FRONT === "0") return;
  for (const name of new Set(script.map((l) => ROLES[l.role].modelName))) {
    const modelId = modelIds.get(name);
    if (modelId) void faceFront(client, modelId);
  }
}, 2000);

/** 台詞 1 つを合成へ回す形にする。台本の並びから、そのまま引数を作る。 */
const toPrepareOptions = (line: Line) => ({
  raw: line.text,
  roleName: line.role,
  role: ROLES[line.role],
  subtitle,
  withName: SUBTITLE_WITH_NAME,
});

// 1 台詞めの合成を先に始める。
//
// 合成には 1 秒前後かかる。喋る直前に始めると、その 1 秒がまるごと無音になる。
// 1 つ先を常に走らせておけば、待ちは 1 台詞めだけになる。
let prepared: PreparedSpeech | undefined = script[0]
  ? prepareLine(toPrepareOptions(script[0]))
  : undefined;

for (const [index, line] of script.entries()) {
  const role = ROLES[line.role];
  const modelId = modelIds.get(role.modelName)!;
  console.log(`[${index + 1}/${script.length}] ${line.role}: ${line.text}`);

  const current = prepared;
  // 次の台詞の合成を、この台詞を鳴らす前に始める。
  const next = script[index + 1];
  prepared = next ? prepareLine(toPrepareOptions(next)) : undefined;

  const result = await performLine({
    client,
    raw: line.text,
    roleName: line.role,
    role,
    modelId,
    subtitle,
    withName: SUBTITLE_WITH_NAME,
    prepared: current,
  });
  console.log(
    `    ${result.durationSec.toFixed(1)} 秒 / 口パク ${result.mouthOk} 回` +
      ` / 合成待ち ${result.synthWaitMs}ms`,
  );

  await subtitle?.clear();
  // 表情を戻す。次の台詞に前の感情が残らないようにする。
  await resetEmotion(client, modelId);
}

console.log("\n再生を終えた");
clearInterval(posture);
await subtitle?.clear();

// 姿勢と表情を素へ戻す。聞いている側にも前の感情が残る。
for (const name of new Set(script.map((l) => ROLES[l.role].modelName))) {
  const modelId = modelIds.get(name);
  if (!modelId) continue;
  await returnToIdle(client, modelId);
  await resetEmotion(client, modelId);
}
// 戻る表情のフェードが終わるまで待つ。切断が先だと途中で止まる。
await new Promise((resolve) => setTimeout(resolve, 700));

closeAudioPlayer();
closeSubtitleRenderer();
client.close();
