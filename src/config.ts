// 環境ごとに変わる設定。
//
// 既定値だけで動くようにしてある。clone した直後、何も置かずに動く。
// 変えたいところがあるときだけ、リポジトリ直下に config.local.json を置く。
// 書いた項目だけが既定を上書きする。
//
// config.local.json は追跡しない。人によって中身が違うため。
//
// ここに置くのは、その環境で決めたら変えないもの。
// 走らせるたびに切り替えるスイッチはフラグで渡す。混ぜると置き場が読めなくなる。
//
//   --no-subtitle    字幕を出さない
//   --no-speak       喋らせず、台本だけ作る
//   --no-face-front  正面へ向け続けるのをやめる
//   --style "..."    掛け合いの運び方を、その回だけ注文する
//
// 調べるとき用の 2 つだけ環境変数のままにしてある。実行の全体に効かせたいため。
//
//   SUBTITLE_KEEP=1  出した字幕の画像を消さずに残す
//   NIZIMA_TRACE=1   落ちたときに、呼び出しの跡も出す

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// このファイルは src の直下にある。1 つ上がリポジトリの根。
export const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export interface Config {
  /**
   * ペルソナ定義の置き場。
   *
   * 既定はリポジトリに同梱したもの。自分の定義を使うときは、
   * config.local.json でここを差し替える。
   */
  personaDir: string;
  /**
   * nizima LIVE がモデルを置くフォルダ。
   *
   * 口パク用の複製を作るときに読み書きする（src/setup/make-talk-models.ts）。
   */
  modelsRoot: string;
  /**
   * nizima LIVE Plugin API の繋ぎ先。
   *
   * ポートはプラグインマネージャーで変えられる。既定は 22022。
   */
  nizimaUrl: string;
  /** VOICEVOX Engine の待ち受け先。 */
  voicevoxUrl: string;
  /**
   * 句読点で黙る時間の上限（秒）。
   *
   * VOICEVOX は読点の前に来る語で黙る長さを変える。感動詞のあとは長くとる。
   * ひとりで語るならこれでよいが、掛け合いでは間延びして聞こえる。
   * 短いほうへ合わせるのではなく、長すぎるものだけを抑える。
   *
   * 耳で確かめて決める値。
   */
  voicevoxMaxPauseSec: number;
  /**
   * 句読点で入る無音の長さの倍率。
   *
   * 区切りを入れるのは読みが変わる場所だけにしてあるため、既定のままでよい。
   */
  voicevoxPauseScale: number;
  /** 発言を作る LLM。 */
  talkLlmModel: string;
  /**
   * 読みの確認に使う LLM。
   *
   * 台本 1 本につき 1 回しか呼ばない。回数が少ないので、
   * 軽さより見落としの少なさを採る。
   */
  verifyLlmModel: string;
  /**
   * 字幕に話者名を出すか。
   *
   * 2 体が交互に喋るときは、誰の台詞かが色だけでは追いにくい。
   */
  subtitleWithName: boolean;
}

const DEFAULTS: Config = {
  personaDir: path.join(REPO_ROOT, "personas"),
  modelsRoot: path.join(
    process.env.APPDATA ?? "",
    "Live2D",
    "nizima LIVE",
    "models",
  ),
  nizimaUrl: "ws://localhost:22022/",
  voicevoxUrl: "http://127.0.0.1:50021",
  voicevoxMaxPauseSec: 0.35,
  voicevoxPauseScale: 1,
  // Opus と聞き比べた。短い会話なら品質に差が出ない印象なので、単価の低いほうにする。
  talkLlmModel: "claude-sonnet-5",
  verifyLlmModel: "claude-sonnet-5",
  subtitleWithName: true,
};

const CONFIG_FILE = path.join(REPO_ROOT, "config.local.json");

function load(): Config {
  if (!existsSync(CONFIG_FILE)) return DEFAULTS;

  // 読めない設定を黙って捨てない。
  // 書いたのに効かない状態は、既定で動いてしまうぶん気づきにくい。
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch (error) {
    throw new Error(
      `${CONFIG_FILE} を読めない: ${(error as Error).message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${CONFIG_FILE} の中身がオブジェクトではない`);
  }

  const known = new Set(Object.keys(DEFAULTS));
  const unknown = Object.keys(parsed).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${CONFIG_FILE} に知らない項目がある: ${unknown.join(", ")}`,
    );
  }

  // 型も見る。数を待つところに文字列を書くと、計算がすべて NaN になる。
  // エラーは出ず、音の間だけがおかしくなるので気づきにくい。
  for (const [key, value] of Object.entries(parsed)) {
    const expected = typeof DEFAULTS[key as keyof Config];
    if (typeof value !== expected) {
      throw new Error(
        `${CONFIG_FILE} の ${key} は ${expected} で書く（いまは ${typeof value}）`,
      );
    }
  }

  return { ...DEFAULTS, ...(parsed as Partial<Config>) };
}

export const config = load();
