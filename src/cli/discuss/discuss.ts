// お題を渡して、2 体のモデルに議論させる。
//
// 台本は用意しない。発言はその場で生成し、再生し、次の発言の材料にする。
//
// 使い方:
//   npm run discuss -- "<お題>" [往復数] [先に話す役]
//
// 先に話す役を書かなければ、毎回どちらかに振る。
//
// 生成には Claude Agent SDK を使う。Claude Code のログインをそのまま使うため
// API キーは要らない。料金はサブスクリプションの枠から引かれる。
//
// 発言を作るところは writer.ts、指示の組み立ては persona.ts にある。
import "../../fail-clean.js";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { config } from "../../config.js";
import { NizimaClient } from "../../nizima/client.js";
import { MODELS, MODEL_NAMES } from "../../perform/models.js";
import { extractEmotion, resetEmotion, returnToIdle } from "../../perform/emotion.js";
import { performLine } from "../../perform/perform.js";
import {
  resolveModelIds,
  faceFront,
  closeAudioPlayer,
  warmUp,
  MOUTH_INTERVAL_MS,
} from "../../perform/speak.js";
import { TAKES_DIR } from "../../script/takes.js";
import {
  Subtitle,
  closeSubtitleRenderer,
  takeRenderElapsedMs,
  takePlaceElapsedMs,
} from "../../stage/subtitle.js";
import { createWriter, type Line, type LineSession } from "./writer.js";

/**
 * 発言を作るモデル。
 *
 * 同じお題で 4 本を作り、どちらで作ったかを伏せて聞き比べた。
 * 上位 2 本に両方が 1 本ずつ入り、差は付かなかった。
 * 会話の面白さで劣らないため、単価の低いほうを採る。
 *
 * 差し替えは config.local.json の discussModel で。
 */
const MODEL = config.discussModel;

// 発言と発言の間はここで作らない。
//
// 音声の末尾に、文の終わりぶんの無音が既に入っている。
// ここでも待つと足し算になり、掛け合いが間延びする。

/** 字幕に話者名を付けるか。 */
const SUBTITLE_WITH_NAME = config.subtitleWithName;

/** 字幕を出すか。SUBTITLE=0 で切る。 */
const SUBTITLE_ENABLED = process.env.SUBTITLE !== "0";

/**
 * 喋らせるか。SPEAK=0 で台本だけ作る。
 *
 * 同じお題を何度も回して読み比べるとき、再生の時間がそのまま待ち時間になる。
 * 声も口も要らないなら、作るところで止める。
 */
const SPEAK = process.env.SPEAK !== "0";

const topic = process.argv[2];
const rounds = Number.parseInt(process.argv[3] ?? "6", 10);

if (!topic) {
  console.error('usage: npm run discuss -- "<お題>" [往復数] [先に話す役]');
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

const modelIds = await resolveModelIds(client);

// どちらから話し始めるかを決める。
//
// 固定にすると、同じ役がいつも話題を切り出す側になる。
// 切り出す側と受ける側では発言の作りが変わるため、
// 何度も回すうちに会話の形が似てくる。
//
// 第 3 引数で指名できる。書かなければ毎回どちらかに振る。
//
// 誰が出るかは models.ts が決める。ここには名前を書かない。
const speakers = [...MODEL_NAMES];
if (speakers.length !== 2) {
  console.error(
    `2 体で会話させる。models.ts のモデルは ${speakers.length} 体ある: ${speakers.join(" / ")}`,
  );
  client.close();
  process.exit(1);
}

const firstSpeaker = process.argv[4];
if (firstSpeaker && !speakers.includes(firstSpeaker)) {
  console.error(
    `先に話す役が違う: ${firstSpeaker}（${speakers.join(" / ")} のどちらか）`,
  );
  client.close();
  process.exit(1);
}
if (firstSpeaker ? firstSpeaker === speakers[1] : Math.random() < 0.5) {
  speakers.reverse();
}

const missing = speakers.filter((name) => !modelIds.has(MODELS[name].modelName));
if (missing.length > 0) {
  console.error(
    `モデルが画面に出ていない役: ${missing.join(", ")}\n` +
      "src/cli/scene/add-model.ts で追加してから実行する",
  );
  client.close();
  process.exit(1);
}

const subtitle = SUBTITLE_ENABLED && SPEAK ? new Subtitle(client) : null;

// 両方を正面に向け続ける。
// 素の立ち絵が左向きなので、放っておくと 2 体とも画面の外を見た状態になる。
//
// 送る間隔を空けると、その合間にモデルが元の向きへ戻ろうとして、
// 次の送信でまた正面へ飛ぶ。それが階段状の動きに見える。
// 口パクと同じ間隔で送り続けて、戻る余地をなくす。
const posture = setInterval(() => {
  for (const name of speakers) {
    const modelId = modelIds.get(MODELS[name].modelName);
    if (modelId) void faceFront(client, modelId);
  }
}, MOUTH_INTERVAL_MS);

/** 中断されたときに口が開いたままにならないよう、両モデルを閉じる。 */
async function closeMouths(): Promise<void> {
  for (const name of speakers) {
    const modelId = modelIds.get(MODELS[name].modelName);
    if (!modelId) continue;
    await client
      .request("SetLiveParameterValues", {
        ModelId: modelId,
        LiveParameterValues: [{ Id: "MouthOpen", Value: 0 }],
      })
      .catch(() => {});
  }
}

process.on("SIGINT", () => {
  console.log("\n中断する");
  clearInterval(posture);
  void (async () => {
    await subtitle?.clear().catch(() => {});
    await closeMouths();
    client.close();
    process.exit(0);
  })();
});

console.log(`お題: ${topic}`);
console.log(`往復数: ${rounds}`);
console.log(`先に話す: ${speakers[0]}`);
console.log(`モデル: ${MODEL}\n`);

// 重い準備を先に済ませる。
// 音を鳴らすプロセス、字幕の描画、話者の読み込みは最初の 1 回だけ時間がかかる。
// 台詞の途中で払うと、そこで会話が止まって見える。
// 喋らせないなら、この準備も要らない。
if (SPEAK) {
  const warmUpStartedAt = Date.now();
  await warmUp(
    Object.values(MODELS).map((role) => role.speakerId),
    client,
  );
  console.log(`準備を終えた（${Date.now() - warmUpStartedAt}ms）\n`);
}

const writer = createWriter({
  topic,
  model: MODEL,
  speak: SPEAK,
  subtitle,
  withName: SUBTITLE_WITH_NAME,
  styleNote: process.env.STYLE_NOTE?.trim() || undefined,
});

const history: Line[] = [];
const total = rounds * 2;

// 喋った内容を台本として残す。
//
// 同じお題でも毎回ちがう内容になるため、気に入った回はもう出てこない。
// 残しておけば、録画をやり直すときに同じ内容を再現できる。
// 台詞を手で直してから読み直すこともできる。
const script: string[] = [
  `# お題: ${topic}`,
  `# 生成: ${new Date().toLocaleString("ja-JP")}`,
  // どのモデルで作ったかを残す。聞き比べたあとで見分けがつかなくなる。
  `# モデル: ${MODEL}`,
  "",
];

/**
 * いま仕込んでいる発言。
 *
 * 1 手めは、生成そのものを待つことになる。読みの確認は間に合わない。
 * 最初の発言だけは直らないが、台本にしたあとで直せる。
 */
let session: LineSession | undefined = writer.startLine(
  speakers[0],
  speakers[1],
  history,
);

for (let turn = 0; turn < total; turn++) {
  const roleName = speakers[turn % 2];
  const partnerName = speakers[(turn + 1) % 2];

  if (!session) break;

  // 直す前の形をまず受け取る。ここで生成そのものを待つ。
  const drafted = await session.draft;
  if (!drafted) {
    console.error(`${roleName} の発言が空だった。ここで止める`);
    break;
  }

  // 読みを直した形が音まで出来ていれば、そちらへ差し替える。
  // 出来ていなければ打ち切って、直す前の形で喋る。
  // 待つと、残りがそのまま発言の頭の無音になる。
  let use = drafted;
  if (session.isFixedReady()) {
    use = (await session.fixed) ?? drafted;
  } else {
    session.abandon();
  }
  const fixMs = session.fixMs();
  const fixed = use !== drafted;

  const role = MODELS[roleName];
  const speakerModelId = modelIds.get(role.modelName)!;

  // 履歴と台本には、実際に喋る形を残す。
  // 直す前を残すと、台本を読み直したときに同じ誤読が戻る。
  const { raw, prepared } = use;
  const { emotion, text: body } = extractEmotion(raw);
  history.push({ role: roleName, text: body });
  script.push(`${roleName}: ${raw}`);
  console.log(`[${turn + 1}/${total}] ${roleName} (${emotion}): ${body}`);

  // 次の発言を仕込んでから再生する。ここは await しない。
  session =
    turn < total - 1
      ? writer.startLine(partnerName, roleName, [...history])
      : undefined;

  // 台本だけ欲しいときは、ここから先を飛ばす。
  // 何度も回して読み比べるとき、再生の時間がそのまま待ち時間になる。
  if (!SPEAK) continue;

  const spoken = await performLine({
    client,
    raw,
    roleName,
    role,
    modelId: speakerModelId,
    subtitle,
    withName: SUBTITLE_WITH_NAME,
    prepared,
  });
  // 待ち時間を出す。どれが延びても台詞の切れ目で間が空く。
  //
  // 合成待ちは、音ができるのを待って止まっていた時間。先読みが効けば 0 に近い。
  // 再生待ちは、そこから音を鳴らし始めるまでの時間。中身は pwsh の準備で、
  // 合成の時間は含まない。2 つは別のものなので分けて出す。
  //
  // 口パクの送信回数も出す。台詞の長さに対して多すぎるなら、
  // 止めそこねたループが残っている。
  //
  // 読み確認は、直しが間に合ったかどうか。
  // 「間に合わず」が続くなら、生成と確認の合計が再生の長さを超えている。
  // 「直しなし」は、確かめた結果、直すところが無かったということ。
  const verify = fixed
    ? `${fixMs}ms`
    : fixMs === undefined
      ? "間に合わず"
      : `直しなし ${fixMs}ms`;
  const expected = Math.round((spoken.durationSec * 1000) / MOUTH_INTERVAL_MS);
  console.log(
    `      （読み確認 ${verify}` +
      ` / 合成待ち ${spoken.synthWaitMs}ms / 再生待ち ${spoken.readyDelayMs}ms` +
      ` / 字幕 ${takeRenderElapsedMs()}ms` +
      ` / 位置決め 最長 ${takePlaceElapsedMs()}ms` +
      ` / 口パク ${spoken.mouthOk}回 目安 ${expected}回）`,
  );

  await subtitle?.clear();
  // 姿勢はここでは戻さない。
  // 待機モーションは素の姿そのもので、発言のたびに挟むと
  // 感情の姿勢から素へ戻り、また次の感情へ動く往復が見える。
  // 次の発言のモーションが前の姿勢を引き継ぐほうが、動きがつながる。
  //
  // 表情を戻す。次の発言に前の感情が残らないようにする。
  await resetEmotion(client, speakerModelId);
}

console.log("\n議論を終えた");

// 台本を書き出す。気に入った回をあとで読み直せる。
const stamp = new Date()
  .toLocaleString("sv-SE")
  .replace(/[-: ]/g, "")
  .slice(0, 14);
const takePath = path.join(TAKES_DIR, `${stamp}.txt`);
mkdirSync(TAKES_DIR, { recursive: true });
writeFileSync(takePath, `${script.join("\n")}\n`, "utf-8");
console.log(`台本を残した: ${takePath}`);
console.log(`  同じ内容をもう一度: npm run cast -- "${takePath}"`);

clearInterval(posture);
await subtitle?.clear();
await closeMouths();

// 姿勢と表情を素へ戻す。最後に喋った側だけでは足りない。
// 相手の発言を聞いている側にも残り、汗をかいた顔のまま議論が終わる。
for (const role of Object.values(MODELS)) {
  const modelId = modelIds.get(role.modelName);
  if (!modelId) continue;
  await returnToIdle(client, modelId);
  await resetEmotion(client, modelId);
}
// 戻る表情のフェードが終わるまで待つ。切断が先だと途中で止まる。
await new Promise((resolve) => setTimeout(resolve, 700));

closeAudioPlayer();
closeSubtitleRenderer();
client.close();
