import type { NizimaClient } from "./nizima-client.js";

/**
 * 発言の感情を、表情とモーションに割り当てる。
 *
 * nizima の感情分析は AI アシスタント機能の側にあり、Plugin API からは使えない。
 * 代わりに、発言を作るときに感情を自己申告させる。
 * 何を喋るかを決めているのはこちらなので、後から分析するより取り違えが少ない。
 *
 * 表情とモーションの名前はモデル間でほぼ共通だが、中身は同じとは限らない。
 * 実際 exp_shy は、めたんが「あたふた」でずんだもんが「ハート目」だった。
 * 共通の割り当てを土台にして、合わないものだけモデルごとに差し替える。
 * 名前が無いモデルでは、その感情を飛ばす。
 */

// 何をどう出すかは models.ts が持つ。モデル 1 体ぶんの定義をそこにまとめてある。
export {
  COMMON_LOOKS as EMOTIONS,
  EMOTION_NAMES,
  resolveLook as resolveEmotion,
  resolveSpeakerId,
  resolveVoiceTuning,
  type EmotionLook as EmotionMapping,
} from "./models.js";

import { COMMON_LOOKS, resolveLook } from "./models.js";

/**
 * 発言の先頭に付いた感情タグを取り出す。
 *
 * 例: 「[laugh] そうなのだ」→ { emotion: "laugh", text: "そうなのだ" }
 * タグが無い、または知らない名前なら neutral として扱う。
 */
export function extractEmotion(raw: string): {
  emotion: string;
  text: string;
} {
  const matched = raw.match(/^\s*[[［]\s*([a-zA-Z]+)\s*[\]］]\s*/);
  const emotion = matched && COMMON_LOOKS[matched[1].toLowerCase()]
    ? matched[1].toLowerCase()
    : "neutral";

  // 外すのは先頭のタグだけ。途中のタグは残す。
  // 表情を切り替える位置として splitIntoEmotionSegments が使う。
  // 読み上げの手前でそちらが消費するため、声には出ない。
  const text = raw
    .replace(/^\s*[[［]\s*[a-zA-Z]+\s*[\]］]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  return { emotion, text: text || raw.trim() };
}

/** 感情の切り替わりで区切った、発言の一区間。 */
export interface EmotionSegment {
  emotion: string;
  text: string;
}

/**
 * 発言を、感情タグの位置で区切る。
 *
 * 表情を発言の頭で 1 回だけ出すと、長い台詞のあいだ同じ顔が続く。
 * 笑った顔のまま真顔の内容を喋ることになり、見ていて噛み合わない。
 *
 * 発言の途中にもタグを置かせ、そこで表情を切り替える。
 * 音声の合成が終わってから解析するのでは間に合わないため、
 * 何を喋るかを決める側にタグを出させる。改行位置や読みと同じ考え方。
 *
 * 知らないタグ名が来たら、その区間は前の感情のまま続ける。
 * neutral に落とすと、綴りの誤りひとつで顔が急に素へ戻る。
 *
 * initial には発言の頭で出した感情を渡す。
 * 先頭のタグは本文から外してあるため、渡さないと最初の区間が neutral になり、
 * 出したばかりの表情がすぐ素へ戻る。
 */
export function splitIntoEmotionSegments(
  raw: string,
  initial = "neutral",
): EmotionSegment[] {
  const pattern = /[[［]\s*([a-zA-Z]+)\s*[\]］]/g;
  const segments: EmotionSegment[] = [];

  let current = initial;
  let cursor = 0;
  let matched: RegExpExecArray | null;

  const push = (text: string, emotion: string) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    // 同じ感情が続くなら前の区間へまとめる。表情を出し直さない。
    const previous = segments[segments.length - 1];
    if (previous && previous.emotion === emotion) {
      previous.text = `${previous.text} ${trimmed}`.trim();
      return;
    }
    segments.push({ emotion, text: trimmed });
  };

  while ((matched = pattern.exec(raw)) !== null) {
    push(raw.slice(cursor, matched.index), current);
    const name = matched[1].toLowerCase();
    if (COMMON_LOOKS[name]) current = name;
    cursor = matched.index + matched[0].length;
  }
  push(raw.slice(cursor), current);

  return segments.length > 0
    ? segments
    : [{ emotion: initial, text: raw.trim() }];
}

/**
 * 名前で表情を再生する。持っていない表情なら何もしない。
 *
 * 出ている表情を止めてから出す。
 * 素の顔へ戻す表情は Overwrite で値を握る。残ったままだと、
 * 新しい表情の加算を打ち消して顔が変わらない。
 */
async function startExpression(
  client: NizimaClient,
  modelId: string,
  name: string,
): Promise<void> {
  const expressions = (await client
    .request("GetExpressions", { ModelId: modelId })
    .catch(() => null)) as {
    Expressions: Array<{ Name: string; ExpressionPath: string }>;
  } | null;

  const found = expressions?.Expressions.find((e) => e.Name === name);
  if (!found) return;

  await client
    .request("StopAllExpressions", { ModelId: modelId })
    .catch(() => {});
  await client
    .request("StartExpression", {
      ModelId: modelId,
      ExpressionPath: found.ExpressionPath,
    })
    .catch(() => {});
}

/**
 * 表情だけを切り替える。モーションは出さない。
 *
 * 発言の途中で感情が変わったときに呼ぶ。
 * モーションは体の動きなので、区間ごとに変えると身体がぶれる。
 * 身振りは発言の頭で 1 回だけ出し、そのまま流す。
 *
 * think や agree のように表情を持たない感情では、出ている表情を止めるだけにする。
 * 前の表情を残すと、真顔で言う内容を笑ったまま喋ることになる。
 *
 * ここで素の顔へ戻す表情は使わない。
 * あれは Overwrite で値を握るため、消える途中で下にある前の表情が透ける。
 * 区間が変わるたびに出し直すと、一瞬だけ違う顔が現れて戻る。
 */
export async function applyExpressionOnly(
  client: NizimaClient,
  modelId: string,
  emotion: string,
  modelName?: string,
): Promise<void> {
  const mapping = modelName
    ? resolveLook(modelName, emotion)
    : COMMON_LOOKS[emotion];

  if (!mapping?.expression) {
    await client
      .request("StopAllExpressions", { ModelId: modelId })
      .catch(() => {});
    return;
  }
  await startExpression(client, modelId, mapping.expression);
}

/**
 * 表情とモーションを、そのモデルが持っているものだけ再生する。
 *
 * modelName は差し替えを引くために使う。省くと共通の割り当てになる。
 */
export async function applyEmotion(
  client: NizimaClient,
  modelId: string,
  emotion: string,
  modelName?: string,
): Promise<void> {
  const mapping = modelName
    ? resolveLook(modelName, emotion)
    : COMMON_LOOKS[emotion];
  if (!mapping) return;

  if (mapping.expression) {
    await startExpression(client, modelId, mapping.expression);
  }

  if (mapping.motion) {
    const motions = (await client
      .request("GetMotions", { ModelId: modelId })
      .catch(() => null)) as {
      Motions: Array<{ Name?: string; MotionPath?: string }>;
    } | null;
    const found = motions?.Motions.find((m) => m.Name === mapping.motion);
    if (found?.MotionPath) {
      await client
        .request("StartMotion", {
          ModelId: modelId,
          MotionPath: found.MotionPath,
        })
        .catch(() => {});
    }
  }
}

/**
 * 素の姿へ戻すための待機モーションの名前。
 *
 * 実体は src/setup/make-idle-motion.ts が作る。
 * 全モーションが触るパラメータの既定値を並べただけのもの。
 */
export const IDLE_MOTION_NAME = "mtn_idle";

/**
 * 姿勢を素へ戻す。
 *
 * モーションが動かした値は、そのモーションを止めても既定へ戻らない。
 * 止めれば一段で飛び、ループを切っても最後の値で固まる。
 * 戻す道は別のモーションへ乗り換えることだけで、乗り換えならフェードがかかる。
 *
 * ただしフェードするのは、新しいモーションが持つ値だけ。
 * だから待機モーションは、全モーションが触る値をすべて持たせてある。
 */
export async function returnToIdle(
  client: NizimaClient,
  modelId: string,
): Promise<void> {
  const motions = (await client
    .request("GetMotions", { ModelId: modelId })
    .catch(() => null)) as {
    Motions: Array<{ Name?: string; MotionPath?: string }>;
  } | null;
  const idle = motions?.Motions.find((m) => m.Name === IDLE_MOTION_NAME);
  if (!idle?.MotionPath) return;
  await client
    .request("StartMotion", { ModelId: modelId, MotionPath: idle.MotionPath })
    .catch(() => {});
}

/**
 * 素の顔へ戻すための表情の名前。
 *
 * 実体は src/setup/make-reset-expression.ts が作る。
 * 表情が触るパラメータの既定値を Overwrite で並べたもの。
 */
export const RESET_EXPRESSION_NAME = "exp_reset";

/**
 * 表情が動かすパラメータの名前。顔まわりだけを対象にする。
 *
 * 耳・髪・体はモーションが動かす領域なので触らない。
 * ここを含めて戻すと、モーションの途中の姿勢から既定値へ一段で飛び、
 * 耳が立った状態と垂れた状態が切り替わるように見える。
 *
 * Pattern と Sweat も対象に入れる。
 * ParamPatternBrow は「Pattern」が先頭に来るため Brow では拾えない。
 * ParamSweat も漏れていて、汗をかいた顔のまま次の発言へ持ち越していた。
 */
const FACE_PARAM_PATTERN =
  /^Param(Eye|Brow|Mouth|Cheek|Tere|Face|Sweat|Pattern|Tongue)/i;

/**
 * 表情を戻す。次の発言に前の感情が残らないようにする。
 *
 * 素の顔へ戻す表情を再生する。表情として再生するため FadeInTime が効き、
 * 前の表情から滑らかに戻る。
 *
 * パラメータを直接書き戻す方法は使わない。
 * StopAllExpressions は FadeOutTime をかけて減衰させるが、その途中で
 * 値を上書きすると、フェードを自分で潰して一段で飛ぶ。
 *
 * 戻す表情を持たないモデルでは、従来どおり顔まわりを書き戻す。
 * StopAllExpressions だけでは加算が残り、汗や眉のパターンが顔に残る。
 */
export async function resetEmotion(
  client: NizimaClient,
  modelId: string,
): Promise<void> {
  const expressions = (await client
    .request("GetExpressions", { ModelId: modelId })
    .catch(() => null)) as {
    Expressions: Array<{
      Name: string;
      ExpressionPath: string;
      Active?: boolean;
    }>;
  } | null;

  const reset = expressions?.Expressions.find(
    (e) => e.Name === RESET_EXPRESSION_NAME,
  );
  if (reset) {
    // 素の顔だけが出ているなら触らない。
    // 止めて出し直すと、消えていく途中で下にある前の表情が透ける。
    // 一瞬だけ違う顔が現れて戻るように見える。
    //
    // ほかの表情が重なっているときは対象外。
    // 素の顔が出ていても、その上に乗ったものは消さないと戻らない。
    const active = (expressions?.Expressions ?? []).filter((e) => e.Active);
    if (active.length === 1 && active[0].Name === RESET_EXPRESSION_NAME) return;

    // 先に出ている表情を止める。
    // 止めずに重ねると、前の表情の加算が戻す表情の Overwrite より後に乗る。
    // ずんだもんの exp_surprise が消えず、驚いた顔のまま残った。
    await client
      .request("StopAllExpressions", { ModelId: modelId })
      .catch(() => {});
    await client
      .request("StartExpression", {
        ModelId: modelId,
        ExpressionPath: reset.ExpressionPath,
      })
      .catch(() => {});
    return;
  }

  await client
    .request("StopAllExpressions", { ModelId: modelId })
    .catch(() => {});

  const defs = (await client
    .request("GetCubismParameters", { ModelId: modelId })
    .catch(() => null)) as {
    CubismParameters?: Array<{ Id: string; DefaultValue: number }>;
  } | null;

  const face = (defs?.CubismParameters ?? []).filter((p) =>
    FACE_PARAM_PATTERN.test(p.Id),
  );
  if (face.length === 0) return;

  await client
    .request("SetCubismParameterValues", {
      ModelId: modelId,
      CubismParameterValues: face.map((p) => ({
        Id: p.Id,
        Value: p.DefaultValue,
      })),
    })
    .catch(() => {});
}
