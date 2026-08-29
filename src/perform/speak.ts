import { rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { NizimaClient } from "../nizima/client.js";
import type {
  GetExpressionsResponse,
  GetModelsResponse,
} from "../nizima/types.js";
import { synthesize, initializeSpeaker, type Silence } from "../voice/voicevox.js";
import { AudioPlayer } from "../voice/audio-player.js";
import { warmUpSubtitleRenderer, warmUpSubtitleItem } from "../stage/subtitle.js";
import { finishReading } from "../script/format-speech.js";
import {
  parseLine,
  splitParts,
  toSubtitle,
  toReading,
  toReadingWithPause,
  type Part,
} from "../script/line-parser.js";
import { resolveSpeakerId, resolveVoiceTuning } from "./emotion.js";

/**
 * 音を鳴らす常駐プロセス。
 *
 * 台詞の区切りごとに立ち上げ直すと、そのたびに起動を待つ。
 * 1 つ保って使い回し、待ちを最初の 1 回だけにする。
 */
const player = new AudioPlayer();

/** 常駐プロセスを終う。読み上げを使い終えたら呼ぶ。 */
export function closeAudioPlayer(): void {
  player.close();
}

/**
 * 喋り出す前に、時間のかかる準備をまとめて済ませる。
 *
 * 音を鳴らすプロセスの起動、字幕を描く準備、話者の読み込み。
 * どれも最初の 1 回だけ重い。台詞の途中で払うと、そこで会話が止まって見える。
 */
export async function warmUp(
  speakerIds: number[],
  client?: NizimaClient,
): Promise<void> {
  player.warmUp();
  await Promise.all([
    warmUpSubtitleRenderer(),
    ...speakerIds.map((id) => initializeSpeaker(id)),
  ]);
  // 画面へ出す準備は、描く準備が済んでから行う。
  if (client) await warmUpSubtitleItem(client);
}

/** 合成の済んだ音と、その音を鳴らすのに要る情報。 */
interface SynthesizedChunk {
  wavPath: string;
  durationSec: number;
  speakingSec: number;
  silences: Silence[];
}

/**
 * 合成の途中経過。台詞を読み上げの単位へ分け、先頭の合成を走らせた状態。
 *
 * 合成には 1 秒前後かかる。喋り始めてから作り始めると、そのぶん頭が遅れる。
 * 前の発言を鳴らしている間にこれを作っておけば、待ちを再生の裏へ隠せる。
 */
export interface PreparedSpeech {
  /** 読み上げの単位。字幕の差し替えと表情の切り替えにも使う。 */
  sentences: Array<{ parts: Part[]; emotion: string }>;
  /** 指定した単位の合成を始める。 */
  synthesizeAt: (index: number) => Promise<SynthesizedChunk>;
  /** 先頭の単位の合成。作った時点で走り始めている。台詞が空なら無い。 */
  head?: Promise<SynthesizedChunk>;
}

export interface PrepareSpeechOptions {
  /** 感情タグを外した台詞。 */
  text: string;
  speakerId: number;
  /** 読み上げの単位あたりの最大文字数。指定しなければ切らない。 */
  maxChars?: number;
  /** 発言の頭で出した感情。本文の途中にタグが無い区間は、この感情のまま続く。 */
  emotion?: string;
  /** nizima LIVE 側のモデル名。感情に合う声を引くのに使う。 */
  modelName?: string;
}

/**
 * 一時ファイルの通し番号。
 *
 * 発言をまたいで合成を先読みすると、2 つの発言の先頭が同じ時刻に作られる。
 * 時刻と単位の番号だけで名前を作ると、その 2 つが同じ名前になる。
 */
let wavSerial = 0;

/**
 * 台詞を読み上げの単位へ分け、先頭の合成を始める。
 *
 * 表情の指定・読みの指定・折り返しの印を、文字列のまま扱わない。
 * 部品に分けておけば、切る位置は必ず部品の境目になり、記法が途中で割れない。
 *
 * 感情の区間を先に取ってから長さで割る。逆にすると、
 * 感情の変わり目が単位の途中に来て、表情を切り替える場所が無くなる。
 */
export function prepareSpeech(options: PrepareSpeechOptions): PreparedSpeech {
  const { text, speakerId, maxChars, emotion, modelName } = options;

  const limit = maxChars ?? Number.MAX_SAFE_INTEGER;
  const sentences: Array<{ parts: Part[]; emotion: string }> = [];
  for (const segment of parseLine(text, emotion)) {
    for (const group of splitParts(segment.parts, limit)) {
      sentences.push({ parts: group, emotion: segment.emotion });
    }
  }

  const synthesizeAt = (index: number): Promise<SynthesizedChunk> => {
    const wavPath = path.join(
      tmpdir(),
      `nizima-live-speech-plugin-${process.pid}-${wavSerial++}.wav`,
    );
    // 読み方の指定は音声だけに当てる。字幕には元の表記を出す。
    // 切れ目を落とした形を基本にする。余分な間が入らない。
    // 区切りを入れた形も渡し、読みが変わるときだけそちらを使わせる。
    const { parts, emotion: chunkEmotion } = sentences[index];

    // 感情に合う声があれば、そちらで喋らせる。
    // 話者はスタイルを複数持つ。怒りなら冷たい声、照れなら甘い声。
    // 合う声を持たない感情では、そのモデルの普段の声のまま。
    const voice = modelName
      ? resolveSpeakerId(modelName, chunkEmotion)
      : speakerId;

    // 声の出し方も感情で変える。遅いほど落ち込んで、速いほど気が立って聞こえる。
    // 当てるものが無い感情では、既定の出し方のまま。
    const tuning = modelName
      ? resolveVoiceTuning(modelName, chunkEmotion)
      : undefined;

    return synthesize(finishReading(toReading(parts)), voice, wavPath, {
      withBreaks: finishReading(toReadingWithPause(parts)),
      tuning,
    }).then((result) => ({
      wavPath,
      durationSec: result.durationSec,
      speakingSec: result.speakingSec,
      silences: result.silences,
    }));
  };

  return {
    sentences,
    synthesizeAt,
    head: sentences.length > 0 ? synthesizeAt(0) : undefined,
  };
}

/**
 * 1 体のモデルに 1 つの台詞を喋らせる。
 *
 * 接続済みの client を受け取る。中で接続しない。
 * 掛け合いでは 1 接続のまま何度も呼ぶため、接続はこの関数の外で管理する。
 *
 * 口パクは SetLiveParameterValues で MouthOpen を揺らす方式。
 * 値は 500ms しか維持されないため、再生中は短い間隔で送り続ける。
 */

export interface SpeakOptions {
  text: string;
  /** 口パクを送る先のモデル。掛け合いでは喋る側だけを動かす。 */
  modelId: string;
  speakerId: number;
  expressionName?: string;
  /**
   * 読み上げの単位を喋り始める前に呼ぶ。字幕の差し替えと表情の切り替えに使う。
   *
   * 台詞をまとめて表示すると、長いものが画面に収まらない。
   * 単位ごとに合成して再生するため、その境目で差し替えられる。
   *
   * emotion は、その単位が属する区間の感情。
   * 発言の途中に置かれた感情タグから決まる。タグが無ければ neutral。
   */
  onSentence?: (sentence: string, emotion: string) => Promise<void>;
  /**
   * 読み上げの単位あたりの最大文字数。
   *
   * 字幕に収まる長さで切る。指定しなければ切らない。
   */
  maxChars?: number;
  /**
   * 発言の頭で出した感情。
   *
   * 本文の途中にタグが無い区間は、この感情のまま続く。
   * 渡さないと最初の区間が neutral になり、出したばかりの表情が素へ戻る。
   */
  emotion?: string;
  /**
   * nizima LIVE 側のモデル名。
   *
   * 感情に合う声を引くのに使う。渡さなければ speakerId のまま喋る。
   */
  modelName?: string;
  /**
   * 先に始めておいた合成。
   *
   * 渡すと、この関数は台詞を分け直さない。渡されたものをそのまま鳴らす。
   * 分ける処理が 2 か所で走ると、区切りが食い違って字幕と音がずれる。
   */
  prepared?: PreparedSpeech;
}
export interface SpeakResult {
  durationSec: number;
  mouthOk: number;
  mouthFailed: number;
  /**
   * 再生の準備を待った時間の合計（ミリ秒）。
   *
   * pwsh の起動と wav の読み込みにかかる。
   * 待たずに口を動かすと、この時間だけ口パクが音より先に進む。
   */
  readyDelayMs: number;
  /**
   * 合成の終わりを待った時間の合計（ミリ秒）。
   *
   * 合成そのものにかかった時間ではない。先読みが間に合っていれば 0 に近づく。
   * ここが伸びた区切りでは、音が途切れて無音が入る。
   */
  synthWaitMs: number;
}

/**
 * 口パクの送信間隔（ミリ秒）。
 *
 * 確かめる道具（probe/）も、この間隔で送って条件を揃える。
 */
export const MOUTH_INTERVAL_MS = 120;

/**
 * 経過した秒から、口の開き具合を返す。
 *
 * 音素は解析しない。音節らしいリズムで開閉するだけの簡易版。
 * 閉じきらないよう下限を置く。喋っている間ずっと口が動いて見える。
 *
 * 確かめる道具（probe/）も同じ形を使う。別々に書くと、
 * 本番と違う動きを見ながら競合を切り分けることになる。
 */
export function mouthOpenAt(elapsedSec: number): number {
  const wave = Math.abs(Math.sin(elapsedSec * Math.PI * 3.5));
  return 0.15 + wave * 0.65;
}

/**
 * 再生の準備ができた合図を待つ上限（ミリ秒）。
 *
 * 合図が届かないまま止まると、口が閉じたまま音だけ流れる。
 * 待ちすぎるより、多少ずれても動かすほうがましなので上限を置く。
 */
const PLAYER_READY_TIMEOUT_MS = 3000;

export async function speakOnModel(
  client: NizimaClient,
  options: SpeakOptions,
): Promise<SpeakResult> {
  const {
    text,
    modelId,
    speakerId,
    expressionName,
    onSentence,
    maxChars,
    emotion,
    modelName,
  } = options;

  if (expressionName) {
    const expressions = await client.request<GetExpressionsResponse>(
      "GetExpressions",
      { ModelId: modelId },
    );
    const expression = expressions.Expressions.find(
      (e) => e.Name === expressionName,
    );
    if (expression) {
      await client.request("StartExpression", {
        ModelId: modelId,
        ExpressionPath: expression.ExpressionPath,
      });
    }
  }

  // 合成は呼び出し側で先に始められる。渡されていなければ、ここで始める。
  const prepared =
    options.prepared ??
    prepareSpeech({ text, speakerId, maxChars, emotion, modelName });
  const { sentences } = prepared;

  let totalSec = 0;
  let mouthOk = 0;
  let mouthFailed = 0;
  let readyDelayMs = 0;
  let synthWaitMs = 0;

  // 読むものが無ければ、表情だけ出して戻る。
  if (!prepared.head) {
    return { durationSec: 0, mouthOk: 0, mouthFailed: 0, readyDelayMs: 0, synthWaitMs: 0 };
  }

  // 1 つ先の合成を走らせておく。文の切れ目で合成待ちの無音が入らないようにする。
  let pending = prepared.head;

  for (let index = 0; index < sentences.length; index++) {
    const waitStartedAt = Date.now();
    const { wavPath, durationSec, speakingSec, silences } = await pending;
    synthWaitMs += Date.now() - waitStartedAt;
    if (index + 1 < sentences.length) {
      pending = prepared.synthesizeAt(index + 1);
    }

    await onSentence?.(
      toSubtitle(sentences[index].parts),
      sentences[index].emotion,
    );

    // 再生。読み込みが終わった時点で口パクを始める。
    //
    // 起動した瞬間はまだ音が鳴っていない。
    // そこを再生開始と見なすと、読み込みにかかる時間だけ口パクが先に進む。
    const requestedAt = Date.now();
    let startedAt = Date.now();
    let mouthTimer: NodeJS.Timeout | undefined;

    const startMouth = () => {
      // 二重に始めない。
      // 前のタイマーへの参照が消えると止められなくなり、口が動き続ける。
      if (mouthTimer) return;
      readyDelayMs += Date.now() - requestedAt;
      startedAt = Date.now();
      mouthTimer = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        if (elapsed >= speakingSec) return;

        // 声が出ていない間は口を閉じる。
        // 句読点の間は 0.4 秒を超える。そこで動かし続けると、
        // 黙っているのに口だけ開閉して見える。
        const silent = silences.some(
          (s) => elapsed >= s.start && elapsed < s.end,
        );
        const value = silent ? 0 : mouthOpenAt(elapsed);
        client
          .request("SetLiveParameterValues", {
            ModelId: modelId,
            Overwrite: true,
            LiveParameterValues: [{ Id: "MouthOpen", Value: value }],
          })
          .then(() => {
            mouthOk += 1;
          })
          .catch((error: unknown) => {
            mouthFailed += 1;
            if (mouthFailed === 1) {
              console.error(
                `口パク送信に失敗: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          });
      }, MOUTH_INTERVAL_MS);
    };

    // 合図が来ないまま黙って待たない。
    // 上限まで来たら、ずれを承知で口を動かし始める。
    // startMouth は二重に始めないので、あとから合図が来ても害はない。
    const readyFallback = setTimeout(startMouth, PLAYER_READY_TIMEOUT_MS);

    try {
      await player.play(wavPath, startMouth);
    } finally {
      clearTimeout(readyFallback);
      // 何があっても止める。残すと口が動き続ける。
      if (mouthTimer) clearInterval(mouthTimer);
      mouthTimer = undefined;
      // 途中で投げても消す。残すと一時フォルダに溜まっていく。
      rmSync(wavPath, { force: true });
    }
    totalSec += durationSec;
  }

  await client.request("SetLiveParameterValues", {
    ModelId: modelId,
    LiveParameterValues: [{ Id: "MouthOpen", Value: 0 }],
  });

  return { durationSec: totalSec, mouthOk, mouthFailed, readyDelayMs, synthWaitMs };
}

/**
 * モデルを正面に向ける。
 *
 * めたんもずんだもんも、素の立ち絵が左を向いている。
 * そのまま並べると、2 体とも画面の外を見ていて会話に見えない。
 * 首の角度は右いっぱいで正面が上限なので、向き合わせはできない。
 * 解説動画で 2 体を正面に並べる形式が定番なのは、この制約があるため。
 *
 * 送り先は LiveParameter の Yaw で、Overwrite は false にする。
 * false のときだけ nizima LIVE 側の補正がかかり、値の変化が滑らかになる。
 * true にすると補正を切って上書きするため、変化のたびに一段で飛ぶ。
 *
 * 補正の強さは nizima LIVE 側の設定で決まる。
 * パラメータ設定の「顔の左右の動き → 角度X」にあるスムージングで調整する。
 * 送信間隔や Time を変えても速さは変わらない。
 */
const FACE_FRONT_VALUE = 30;

export async function faceFront(
  client: NizimaClient,
  modelId: string,
): Promise<void> {
  await client
    .request("SetLiveParameterValues", {
      ModelId: modelId,
      Overwrite: false,
      LiveParameterValues: [{ Id: "Yaw", Value: FACE_FRONT_VALUE }],
    })
    .catch(() => {});
}

/**
 * モデル名から ModelId を引く。
 *
 * ModelId は nizima LIVE の起動やモデルの追加で振り直される。
 * 役の定義に ModelId を直書きすると次回起動で壊れるため、名前から都度解決する。
 *
 * 置き場のフォルダ名でも引けるようにしてある。
 * nizima が返す Name はモデルの内部名で、フォルダごと複製しても変わらない。
 * 口パク用に表情を削った複製と元のモデルが、同じ名前で並ぶ。
 * ファイル名を変えても Name は変わらないため、フォルダ名で見分ける。
 */
export async function resolveModelIds(
  client: NizimaClient,
): Promise<Map<string, string>> {
  const models = await client.request<GetModelsResponse>("GetModels");
  const map = new Map<string, string>();
  for (const model of models.Models) {
    if (model.Name) map.set(model.Name, model.ModelId);
    const folder = model.ModelPath?.replace(/\\/g, "/").split("/").at(-2);
    if (folder) map.set(folder, model.ModelId);
  }
  return map;
}
