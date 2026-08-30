// 台詞に書ける感情の名前と、先頭に付いたタグの取り出し。
//
// [smile] の形で台詞へ埋める記法の一部なので、記法を扱う側が持つ。
// その感情で何を出すか（表情・モーション・声）を決めるのは perform/emotion.ts。
//
// 名前をここに置くと、割り当ての書き忘れを型が捕まえられる。
// perform 側は Record<EmotionName, ...> で受けるため、1 つでも欠けると通らない。

export const EMOTION_NAMES = [
  "neutral",
  "laugh",
  "smile",
  "angry",
  "sad",
  "shy",
  "surprise",
  "think",
  "agree",
  "deny",
  "point",
] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

const KNOWN = new Set<string>(EMOTION_NAMES);

/**
 * 台詞に書かれた名前が、感情として通るか。
 *
 * 通らない名前は、記法ではなくただの文字として扱う。
 * 綴りを間違えた [smiel] が消えてしまうより、そのまま画面に出るほうが気づける。
 *
 * 型を絞る形にしてある。これを通せば、そのあとは EmotionName として扱える。
 */
export function isEmotionName(name: string): name is EmotionName {
  return KNOWN.has(name);
}

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
  const found = matched?.[1].toLowerCase();
  const emotion = found && isEmotionName(found) ? found : "neutral";

  // 外すのは先頭のタグだけ。途中のタグは残す。
  // 表情を切り替える位置として line-parser.ts の parseLine が使う。
  // 読み上げの手前でそちらが消費するため、声には出ない。
  const text = raw
    .replace(/^\s*[[［]\s*[a-zA-Z]+\s*[\]］]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  return { emotion, text: text || raw.trim() };
}
