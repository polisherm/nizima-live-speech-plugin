// 発言を 1 つ作り、読みを直すところまでを面倒みる。
//
// 生成と読みの確認を、1 つのセッションへ続けて投げる 2 つの問いで済ませる。
// 別々に呼ぶと、そのたびにモデルの起動へ 4.5 秒かかる。続けて問えば 2 つめは払わない。

import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { MODELS, MODEL_NAMES } from "../../perform/models.js";
import { extractEmotion } from "../../script/emotions.js";
import { prepareLine } from "../../perform/perform.js";
import { buildFixPrompt, acceptFix } from "../../script/verify-reading.js";
import type { PreparedSpeech } from "../../perform/speak.js";
import type { Subtitle } from "../../stage/subtitle.js";
import { buildSystemPrompt } from "./system-prompt.js";

/** 会話の 1 発言。履歴として次の問いに渡す。 */
export interface Line {
  role: string;
  text: string;
}

/** 喋る準備が済んだ発言。 */
export interface Ready {
  /** 感情タグを含んだ台詞。 */
  raw: string;
  /** 先に始めておいた合成。喋らせないときは作らない。 */
  prepared: PreparedSpeech | undefined;
}

/**
 * 1 つの発言を、作るところから喋れる形にするまでの流れ。
 *
 * 出来上がりは 2 段になる。
 * 生成が終わった時点で、直す前の形の音を作り始める。
 * 読みを直せたら、直した形の音を作り直す。
 *
 * 喋る側は、間に合ったほうを使う。
 * 直しが遅れても、直す前の音がもう出来ているので喋り出しは遅れない。
 */
export interface LineSession {
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

export interface WriterOptions {
  /** 何について話すか。 */
  topic: string;
  /** 発言を作るモデル。 */
  model: string;
  /** 喋らせるか。台本だけ欲しいときは false。 */
  speak: boolean;
  /** 字幕。出さないときは null。 */
  subtitle: Subtitle | null;
  /** 字幕に話者名を出すか。 */
  withName: boolean;
  /** この回だけの注文。 */
  styleNote?: string;
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

/** 問いを 1 つ、ユーザーの発言として包む。 */
const asUser = (content: string): SDKUserMessage =>
  ({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  }) as SDKUserMessage;

/**
 * 発言を作らせる問いを組み立てる。
 *
 * 会話の始まりだけは、渡し方でそのまま口調に出る。
 */
function buildContext(topic: string, history: Line[]): string {
  return history.length === 0
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
      ].join("\n");
}

/**
 * 発言を作る道具を組み立てる。
 *
 * お題や字幕の設定は回のあいだ変わらないので、包んで持たせる。
 */
export function createWriter(options: WriterOptions) {
  const startLine = (
    roleName: string,
    partnerName: string,
    history: Line[],
  ): LineSession => {
    const role = MODELS[roleName];

    // 2 つめの問いは、1 つめの答えが出てから決まる。
    // 読み上げた音を見せるため、台詞が決まるまで中身が作れない。
    let sendSecond: ((prompt: string | null) => void) | undefined;
    const second = new Promise<string | null>((resolve) => {
      sendSecond = resolve;
    });

    async function* ask(): AsyncGenerator<SDKUserMessage> {
      yield asUser(buildContext(options.topic, history));
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
      prepared: options.speak
        ? prepareLine({
            raw,
            roleName,
            role,
            subtitle: options.subtitle,
            withName: options.withName,
          })
        : undefined,
    });

    const stream = query({
      prompt: ask(),
      options: {
        systemPrompt: buildSystemPrompt({
          personaPath: role.personaPath,
          partnerName,
          styleNote: options.styleNote,
        }),
        model: options.model,
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
  };

  return { startLine };
}
