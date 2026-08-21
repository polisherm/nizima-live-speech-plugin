import path from "node:path";

import { REPO_ROOT } from "./config.js";

/**
 * 台本の置き場。
 *
 * 喋らせた回をここに残す。同じお題でも毎回ちがう内容になるため、
 * 気に入った回は残しておかないと二度と出てこない。
 */
export const TAKES_DIR = path.join(REPO_ROOT, "takes");

/** 台本の 1 行。 */
export interface ScriptLine {
  role: string;
  text: string;
}

/**
 * 台本の 1 行を読む。「役名: 台詞」の形を待つ。
 *
 * 全角のコロンでも受ける。分かれなければ何も返さない。
 */
export function parseScriptLine(line: string): ScriptLine | undefined {
  const matched = line.match(/^([^:：]+)[:：]\s*(.+)$/);
  if (!matched) return undefined;
  return { role: matched[1].trim(), text: matched[2].trim() };
}

/**
 * 台本を丸ごと読む。空行と # で始まる行は飛ばす。
 *
 * 読み取れなかった行は onSkip で知らせる。黙って落とすと、
 * 役名を書き間違えた台詞が再生されない理由が分からない。
 */
export function parseScript(
  source: string,
  onSkip?: (line: string) => void,
): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parsed = parseScriptLine(line);
    if (!parsed) {
      onSkip?.(line);
      continue;
    }
    lines.push(parsed);
  }
  return lines;
}
