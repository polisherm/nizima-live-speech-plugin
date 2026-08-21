import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { performLine, prepareLine } from "../perform/perform.js";
import { buildFixPrompt, acceptFix } from "../script/verify-reading.js";
import { TAKES_DIR } from "../script/takes.js";
import { NizimaClient } from "../nizima/client.js";
import {
  resolveModelIds,
  faceFront,
  closeAudioPlayer,
  warmUp,
  MOUTH_INTERVAL_MS,
  type PreparedSpeech,
} from "../perform/speak.js";
import { MODELS, MODEL_NAMES } from "../perform/models.js";
import {
  Subtitle,
  closeSubtitleRenderer,
  takeRenderElapsedMs,
  takePlaceElapsedMs,
} from "../stage/subtitle.js";
import {
  EMOTION_NAMES,
  returnToIdle,
  extractEmotion,
  resetEmotion,
} from "../perform/emotion.js";

/**
 * お題を渡して、2 体のモデルに議論させる。
 *
 * 台本は用意しない。発言はその場で生成し、再生し、次の発言の材料にする。
 *
 * 使い方:
 *   npx tsx src/cli/discuss.ts "<お題>" [往復数] [先に話す役]
 *
 * 先に話す役を書かなければ、毎回どちらかに振る。
 *
 * 生成には Claude Agent SDK を使う。Claude Code のログインをそのまま使うため
 * API キーは要らない。料金はサブスクリプションの枠から引かれる。
 */

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
  console.error('usage: discuss.ts "<お題>" [往復数] [先に話す役]');
  process.exit(1);
}

interface Line {
  role: string;
  text: string;
}

/**
 * ペルソナ定義を system prompt に組み立てる。
 *
 * 長さと出力形式の指定はここで足す。ペルソナ定義そのものには書かない。
 * 定義は出力チャネルを問わず使い回すものなので、音声固有の制約で汚さない。
 */
function buildSystemPrompt(roleName: string, partnerName: string): string {
  const persona = readFileSync(MODELS[roleName].personaPath, "utf-8");
  return [
    persona,
    "",
    "---",
    "",
    "# この場での振る舞い",
    "",
    `${partnerName}と会話している。相手の発言を受けて、自分の言葉で返す。`,
    "人が話すときのテンポで返す。声に出して読まれるので、一息で言い切れる長さに収める。",
    "言いたいことが多いときは、全部詰め込まずに一番言いたいことだけ返す。残りは相手の反応を見てから出す。",
    "",
    "毎回きちんと意見をまとめない。長さは番ごとに変える。",
    "ひとことで返す番があってよい。驚く、聞き返す、言葉に詰まる、それだけで終わってもいい。",
    "疑問で返すのは本当に聞きたいときだけにする。毎回質問で締めない。",
    "",
    "相手に同意するだけの番を 2 回続けない。話が止まる。",
    "同意するときも、自分の場合はどう違ったかを 1 つ出す。",
    "",
    "お題に会話の進め方が書かれていれば、それに従う。",
    "議論と書かれていれば、相手の言い分をうのみにせず、確かめてから受け入れる。",
    "雑談と書かれていれば、結論を出さずに転がしてよい。",
    "",
    "発言の先頭に、そのときの感情を [ ] で付ける。表情と身振りに使う。",
    `使えるのは ${EMOTION_NAMES.join(" / ")} のどれか。`,
    "迷ったら neutral にする。無理に感情を付けない。",
    "",
    "発言の途中で気持ちが変わるなら、変わる位置にも [ ] を置く。そこで表情が変わる。",
    "驚いてから納得する、笑ってから真顔になる、といった移り変わりを写す。",
    "同じ感情が続くところには置かない。1 つの発言で 3 つまでを目安にする。",
    "",
    "文の終わりには句点（。）を必ず打つ。文の途中の切れ目には読点（、）を打つ。",
    "句点は読み上げと字幕を区切る単位になる。無いと 1 つの塊が長くなり、",
    "字幕が画面に収まらず、息継ぎもないまま喋り続けることになる。",
    "",
    "台詞の中に、意味の切れ目を / で入れる。字幕の改行位置に使う。",
    "10 文字前後を目安に、語の途中で切れない位置へ置く。",
    "「間に合う」「確かめて」のようなひとまとまりの言い回しは割らない。",
    "",
    "読み違えられそうな語には {語|よみ} の形で読みを付ける。声にだけ効き、字幕には元の表記が出る。",
    "読みを付けるのは語ごとに 1 回だけにする。{天{麩羅|ぷら}|テンプラ} のように二重に囲まない。",
    "読みはその場の文脈で正しいものを、カタカナで書く。",
    "ひらがなで書くと、読み上げ側が語の切れ目を見失って別の読みになることがある。",
    "とくに次の 3 つは取り違えられやすい。必ず付ける。",
    "  数量や期間を表す複合語: {一生分|イッショウブン}、{半年分|ハントシブン}",
    "  訓読みと音読みが混ざる語: {朝型|アサガタ}、{手数|テスウ}",
    "  一文字の漢字: {米|コメ}、{前|マエ}、{方|ホウ}、{間|アイダ}、{角|カド}",
    "  訓読みの動詞: {研ぐ|トグ}、{炊く|タク}、{解く|トク}、{被る|カブル}",
    "固有名詞（Live2D、SDK など）には付けない。読みは別に用意してある。",
    "",
    "出力は感情タグと台詞の本文だけにする。",
    "自分の名前を頭に付けない。ト書き（括弧書きの動作説明）も書かない。",
    ...styleNote(),
  ].join("\n");
}

/**
 * 掛け合いの運び方を、その場で足す注文。
 *
 * STYLE_NOTE で渡す。お題に書くと壊れる。
 * お題は「そう話を振られた」内容として渡すため、運び方の注文が
 * 振られた話題そのものに混ざる。
 *
 * 気に入った回の特徴を言葉にして、次を狙って出すのに使う。
 *   STYLE_NOTE="一つの発言を短くする。二文か三文で終える。"
 */
function styleNote(): string[] {
  const note = process.env.STYLE_NOTE?.trim();
  if (!note) return [];
  return ["", "# この回の注文", "", note];
}

/** 正規表現の記号を打ち消す。 */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 生成結果から、台詞以外の混入を落とす。
 *
 * 履歴を「名前: 台詞」の形で渡すため、出力にも名前を付けたがる。
 * 指示だけでは残るので、後処理でも落とす。
 */
function cleanLine(raw: string): string {
  let text = raw.trim();

  // 先頭の役名プレフィックス。
  // 役名は models.ts が決めるので、記号が入っていても壊れないようにする。
  for (const name of MODEL_NAMES) {
    text = text.replace(new RegExp(`^${escapeRegExp(name)}\\s*[:：]\\s*`), "");
  }

  // 括弧書きのト書き
  text = text.replace(/[（(][^）)]*[）)]/g, "");

  // 全体を囲む引用符。開きと閉じが対応するときだけ外す。
  // 片側だけで判断すると、ルビ芸の『日常語――別名――』が台詞の端に来たときに、
  // 対応する記号を落として表記が崩れる。
  const closing: Record<string, string> = {
    "「": "」",
    "『": "』",
    '"': '"',
    "'": "'",
  };
  const head = text[0];
  if (text.length >= 2 && head && closing[head] === text[text.length - 1]) {
    text = text.slice(1, -1).trim();
  }

  return text.replace(/\s+/g, " ").trim();
}

/**
 * 発言を作らせる問いを組み立てる。
 *
 * 会話の始まりだけは、渡し方でそのまま口調に出る。
 */
function buildContext(history: Line[]): string {
  return (
    history.length === 0
      ? [
          // 最初の発言だけは、渡し方がそのまま口調に出る。
          //
          // 話題を名指しして渡すと、それを言い直してから話し始める。
          // 「食感の話ね。」のような復唱が頭に付く。
          //
          // 復唱を禁じると、今度は別の形が出た。
          // 「頭から洗う派か、髪からか。」のような自問や、
          // 「ずんだ餅贔屓の視点から入りたい」のような段取りの宣言になる。
          // どれも、切り出す役目を 1 つ目の発言に負わせたことから来ている。
          //
          // 禁じる形を並べても、次の形が出るだけで終わらない。
          // 役目のほうを外す。聞かれて答えるところから始めれば、
          // 切り出す文そのものが要らなくなる。
          `「${topic}」と話を振られたところ。`,
          "",
          "あなたはもう答え始めている。答えそのものから書く。",
          "話題を言い直さない。これから何を話すかも言わない。",
          "自分に向けた独り言も書かない。相手に聞こえる言葉だけにする。",
        ].join("\n")
      : [
          `お題は「${topic}」。`,
          "",
          "これまでの会話:",
          ...history.map((line) => `${line.role}: ${line.text}`),
          "",
          "あなたの次の発言を返す。",
        ].join("\n")
  );
}

/** 問いを 1 つ、ユーザーの発言として包む。 */
const asUser = (content: string): SDKUserMessage =>
  ({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  }) as SDKUserMessage;

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
// 書くと、モデルを足したときに直す場所が増える。
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

const missing = speakers.filter(
  (name) => !modelIds.has(MODELS[name].modelName),
);
if (missing.length > 0) {
  console.error(
    `モデルが画面に出ていない役: ${missing.join(", ")}\n` +
      "add-model.ts で追加してから実行する",
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
  await warmUp(Object.values(MODELS).map((role) => role.speakerId), client);
  console.log(`準備を終えた（${Date.now() - warmUpStartedAt}ms）\n`);
}

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

/** 喋る準備が済んだ発言。 */
interface Ready {
  /** 感情タグを含んだ台詞。 */
  raw: string;
  /** 先に始めておいた合成。喋らせないときは作らない。 */
  prepared: PreparedSpeech | undefined;
}

/**
 * 1 つの発言を、作るところから喋れる形にするまでの流れ。
 *
 * 生成と読みの確認を、1 つのセッションへ続けて投げる 2 つの問いで済ませる。
 * 別々に呼ぶと、そのたびにモデルの起動へ 4.5 秒かかる。
 * 続けて問えば、2 つめは起動を払わない。
 *
 * 出来上がりは 2 段になる。
 * 生成が終わった時点で、直す前の形の音を作り始める。
 * 読みを直せたら、直した形の音を作り直す。
 *
 * 喋る側は、間に合ったほうを使う。
 * 直しが遅れても、直す前の音がもう出来ているので喋り出しは遅れない。
 */
interface LineSession {
  /** 直す前の形。音を作り始めたところ。 */
  draft: Promise<Ready | undefined>;
  /** 読みを直した形。音が出来上がるまで済んでいる。 */
  fixed: Promise<Ready | undefined>;
  /** 直した形の音まで出来ていれば true。 */
  isFixedReady: () => boolean;
  /** 直しを打ち切る。まだ問うていなければ、問わずに終える。 */
  abandon: () => void;
  /** 読みを確かめるのにかかった時間（ミリ秒）。 */
  fixMs: () => number | undefined;
}

function startLine(
  roleName: string,
  partnerName: string,
  history: Line[],
): LineSession {
  const role = MODELS[roleName];

  // 2 つめの問いは、1 つめの答えが出てから決まる。
  // 読み上げた音を見せるため、台詞が決まるまで中身が作れない。
  let sendSecond: ((prompt: string | null) => void) | undefined;
  const second = new Promise<string | null>((resolve) => {
    sendSecond = resolve;
  });

  async function* ask(): AsyncGenerator<SDKUserMessage> {
    yield asUser(buildContext(history));
    const prompt = await second;
    // 打ち切られたか、確かめようが無ければ、ここで会話を終える。
    if (prompt === null) return;
    yield asUser(prompt);
  }

  let settleDraft: ((value: Ready | undefined) => void) | undefined;
  let settleFixed: ((value: Ready | undefined) => void) | undefined;
  const draft = new Promise<Ready | undefined>((resolve) => {
    settleDraft = resolve;
  });
  const fixed = new Promise<Ready | undefined>((resolve) => {
    settleFixed = resolve;
  });

  let abandoned = false;
  let fixedReady = false;
  let fixMs: number | undefined;

  const prepare = (raw: string): Ready => ({
    raw,
    // 喋らせないなら音は作らない。
    // 台本だけ欲しいときに、要らない合成で待たされないようにする。
    prepared: SPEAK
      ? prepareLine({
          raw,
          roleName,
          role,
          subtitle,
          withName: SUBTITLE_WITH_NAME,
        })
      : undefined,
  });

  const stream = query({
    prompt: ask(),
    options: {
      systemPrompt: buildSystemPrompt(roleName, partnerName),
      model: MODEL,
      effort: "low",
      // 台詞と、その読みの直し。2 つの問いを 1 つのセッションで投げる。
      maxTurns: 4,
      // ツールと MCP を外す。外さないと定義だけで数万トークンがぶら下がる。
      tools: [] as string[],
      allowedTools: [] as string[],
      mcpServers: {},
      extraArgs: { "strict-mcp-config": null },
      settingSources: [] as [],
    },
  });

  void (async () => {
    let answer = "";
    let turn = 0;
    let draftRaw = "";
    let fixStartedAt = 0;

    try {
      for await (const message of stream) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text") answer += block.text;
          }
        }
        if (message.type !== "result") continue;

        turn += 1;
        if (turn === 1) {
          // 感情タグは掃除より先に外す。あとだと役名を落とす処理に引っかかる。
          const { emotion, text } = extractEmotion(answer);
          const body = cleanLine(text);
          answer = "";
          if (!body) break;

          draftRaw = `[${emotion}] ${body}`;
          // 直す前の形で、先に音を作り始める。
          // 直しが間に合わなくても、これがあれば喋り出しは遅れない。
          settleDraft?.(prepare(draftRaw));

          // 読み上げたときの音を見せて、違って読まれる語を直させる。
          fixStartedAt = Date.now();
          const prompt = abandoned
            ? null
            : await buildFixPrompt(draftRaw, role.speakerId);
          sendSecond?.(prompt);
          if (prompt === null) break;
          continue;
        }

        const accepted = await acceptFix(draftRaw, answer, role.speakerId);
        fixMs = Date.now() - fixStartedAt;

        // 打ち切られていたら音を作らない。
        //
        // VOICEVOX は合成を 1 つずつしか処理しない。
        // ここで始めると、鳴らす当ての無い音が、本命の合成を押しのける。
        if (abandoned || !accepted) break;

        const ready = prepare(accepted);
        // 音が出来るまで見届ける。ここまで済んで初めて差し替えられる。
        // 喋らせないときは音を作っていないので、待つものが無い。
        await ready.prepared?.head;
        settleFixed?.(ready);
        fixedReady = true;
        break;
      }
    } catch {
      // 生成そのものが落ちたときは、発言が無かったものとして扱う。
      // 喋る側が空を見て止める。
    }

    // 埋まらなかったほうを閉じる。すでに決まっていれば何も起きない。
    settleDraft?.(undefined);
    settleFixed?.(undefined);
  })();

  return {
    draft,
    fixed,
    isFixedReady: () => fixedReady,
    fixMs: () => fixMs,
    abandon: () => {
      abandoned = true;
      // まだ問うていなければ、問わずに終える。
      sendSecond?.(null);
      // 走っている推論を止める。答えを使わないので、払う意味が無い。
      try {
        stream.close();
      } catch {
        // 閉じられなくても困らない。
      }
    },
  };
}

/**
 * いま仕込んでいる発言。
 *
 * 1 手めは、生成そのものを待つことになる。読みの確認は間に合わない。
 * 最初の発言だけは直らないが、台本にしたあとで直せる。
 */
let session: LineSession | undefined = startLine(
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
      ? startLine(partnerName, roleName, [...history])
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
  const expected = Math.round(
    (spoken.durationSec * 1000) / MOUTH_INTERVAL_MS,
  );
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
console.log(`  同じ内容をもう一度: npx tsx src/cli/cast.ts "${takePath}"`);

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
