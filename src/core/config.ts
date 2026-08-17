// 環境ごとに変わる設定。
//
// 既定値だけで動くようにしてある。clone した直後、何も置かずに動く。
// 変えたいところがあるときだけ、リポジトリ直下に config.local.json を置く。
// 書いた項目だけが既定を上書きする。
//
// config.local.json は追跡しない。人によって中身が違うため。

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
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
   * nizima のプラグインマネージャーに出る開発者名。
   *
   * 初回の登録のときだけ使う。登録済みの環境で変えても、
   * 保存したトークンで接続するかぎり表示は変わらない。
   */
  pluginDeveloper: string;
  /**
   * nizima がモデルを置くフォルダ。
   *
   * 口パク用の複製を作るときに読み書きする（scripts/make-talk-models.py）。
   */
  modelsRoot: string;
}

const DEFAULTS: Config = {
  personaDir: path.join(REPO_ROOT, "personas"),
  pluginDeveloper: "nizima-agent-bridge",
  modelsRoot: path.join(
    process.env.APPDATA ?? "",
    "Live2D",
    "nizima LIVE",
    "models",
  ),
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

  return { ...DEFAULTS, ...(parsed as Partial<Config>) };
}

export const config = load();
