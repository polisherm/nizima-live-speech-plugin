// 1 つの台詞を、声・口パク・表情・字幕をそろえて演じる。
//
// 台詞をその場で作る流れ（discuss）と、書いてある台本を読む流れ（cast）で共有する。
// どちらも見え方は同じにする。
import type { NizimaClient } from "./nizima-client.js";
import { speakOnModel, prepareSpeech, type PreparedSpeech } from "./speak-core.js";
import {
  applyEmotion,
  applyExpressionOnly,
  extractEmotion,
  resolveEmotion,
} from "./emotion.js";
import { Subtitle, SUBTITLE_MAX_CHARS } from "./subtitle.js";
import type { ModelDefinition } from "./models.js";

export interface PerformOptions {
  client: NizimaClient;
  /** 感情タグを含んだままの台詞。 */
  raw: string;
  roleName: string;
  role: ModelDefinition;
  modelId: string;
  subtitle?: Subtitle | null;
  /** 字幕に話者名を出すか。 */
  withName?: boolean;
  /**
   * prepareLine で先に始めておいた合成。
   *
   * 渡すときは、prepareLine に渡したものと同じ raw・roleName・role・
   * subtitle・withName をここにも渡す。食い違うと、字幕と音の区切りがずれる。
   */
  prepared?: PreparedSpeech;
}

export interface PerformResult {
  readyDelayMs: number;
  mouthOk: number;
  durationSec: number;
  /** 合成の終わりを待った時間（ミリ秒）。先読みが間に合っていれば 0 に近い。 */
  synthWaitMs: number;
}

/**
 * 読み上げの区切りとしての上限。
 *
 * 字幕に収まる長さで切る。字幕には話者名が頭に付くので、そのぶんを引く。
 * 字幕を出さないなら切らない。折り返しの位置は描画側が決める。
 */
function readingLimit(
  roleName: string,
  subtitle: Subtitle | null | undefined,
  withName: boolean,
): number | undefined {
  if (!subtitle) return undefined;
  return SUBTITLE_MAX_CHARS - (withName ? roleName.length + 2 : 0);
}

export type PrepareLineOptions = Omit<
  PerformOptions,
  "client" | "modelId" | "prepared"
>;

/**
 * 台詞の合成を先に始める。演じはしない。
 *
 * 合成には 1 秒前後かかる。performLine の中で始めると、その分だけ声が遅れる。
 * 前の発言を鳴らしている間にこれを呼んでおけば、待ちが再生の裏に隠れる。
 *
 * 返したものは performLine の prepared へ渡す。
 */
export function prepareLine(options: PrepareLineOptions): PreparedSpeech {
  const { raw, roleName, role, subtitle } = options;
  const withName = options.withName ?? true;
  const { emotion, text } = extractEmotion(raw);

  return prepareSpeech({
    text,
    speakerId: role.speakerId,
    modelName: role.modelName,
    emotion,
    maxChars: readingLimit(roleName, subtitle, withName),
  });
}

export async function performLine(
  options: PerformOptions,
): Promise<PerformResult> {
  const { client, raw, roleName, role, modelId, subtitle } = options;
  const withName = options.withName ?? true;

  const { emotion, text } = extractEmotion(raw);

  // 表情と身振りは、声を作っている間に当てる。
  //
  // 当て終わるのを待ってから合成を始めると、身振りだけが先に動き出す。
  // 合成には 1 秒ほどかかるため、動いてから一拍おいて喋り出すように見える。
  //
  // 待たずに始めれば、合成が終わる頃には表情も出ている。動きと声がそろう。
  const applying = applyEmotion(client, modelId, emotion, role.modelName).catch(
    (error: unknown) =>
      console.error(
        `表情の適用に失敗: ${error instanceof Error ? error.message : String(error)}`,
      ),
  );

  // いま顔に出ている表情。区切りごとに見比べて、変わったときだけ出し直す。
  //
  // 感情の名前ではなく表情で比べる。
  // think と agree はどちらも表情を持たない感情で、顔は同じ。
  // 名前で比べると切り替えが走り、出し直す一瞬だけ前の表情が透ける。
  let shownExpression = resolveEmotion(role.modelName, emotion)?.expression;

  const spoken = await speakOnModel(client, {
    text,
    modelId,
    speakerId: role.speakerId,
    modelName: role.modelName,
    emotion,
    maxChars: readingLimit(roleName, subtitle, withName),
    // 呼び出し側が合成を先に始めていれば、それを鳴らす。
    prepared: options.prepared,
    // 区切りごとに、表情を切り替え、字幕を差し替える。
    // 字幕をまとめて出すと画面に収まらない。表情も発言の頭だけでは足りず、
    // 長い台詞のあいだ同じ顔が続いて内容と噛み合わなくなる。
    onSentence: async (sentence, chunkEmotion) => {
      const nextExpression = resolveEmotion(
        role.modelName,
        chunkEmotion,
      )?.expression;
      if (nextExpression !== shownExpression) {
        shownExpression = nextExpression;
        // 切り替えるのは顔だけ。身振りは発言の頭で出したものを流す。
        await applyExpressionOnly(client, modelId, chunkEmotion, role.modelName);
      }
      if (!subtitle) return;
      await subtitle
        .show(sentence, role.subtitleColor, withName ? roleName : undefined)
        .catch((error: unknown) =>
          console.error(
            `字幕の表示に失敗: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    },
  });

  // 取りこぼしを防ぐ。ここまで来ていれば、まず終わっている。
  await applying;

  return {
    readyDelayMs: spoken.readyDelayMs,
    mouthOk: spoken.mouthOk,
    durationSec: spoken.durationSec,
    synthWaitMs: spoken.synthWaitMs,
  };
}
