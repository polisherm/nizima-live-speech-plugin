// 口パクが通るモデルの複製を作る。
//
//   npx tsx src/setup/make-talk-models.ts          # ファイルは書き換えず、何をするかだけ出す
//   npx tsx src/setup/make-talk-models.ts --apply  # 複製を作って口の開きを取り除く
//
// nizima LIVE が持つ元のモデルには手を触れない。フォルダごと複製し、複製側の表情と
// モーションから、口の開き（ParamMouthOpenY）だけを取り除く。
//
// 表情は口の開きを Add で加算する。加算値が 1 だと、口パクが何を送っても上限に
// 張り付いて動かなくなる。モーションも同じく口を動かし、こちらは口パクより後に
// 効くため、値をどこへ送っても上書きされる。
//
// 口の形（ParamMouthForm）とパターン（ParamPatternMouth）は残す。
// 笑った口の形のまま開閉できる。
//
// 画面に出る名前は live.json が持つ。フォルダとファイルを改名しても、そこは元のまま。
// 直さないと、モデル一覧に同じ名前が 2 つ並んで見分けられない。
//
// 複製先が既にあるときは、中身だけを処理し直す。名前の書き換えもそのとき効く。
import "../fail-clean.js";
import fs from "node:fs";
import path from "node:path";

import { config } from "../config.js";

/** 元のフォルダと基準名、複製後のフォルダと基準名、画面に出す名前。 */
const TARGETS = [
  {
    sourceDir: "nizima_official_zundamon_ahirushiki",
    sourceBase: "zundamon",
    destDir: "zundamon_talk",
    destBase: "zundamon_talk",
    destNames: { ja: "ずんだもん（口パク用）", en: "Zundamon (Lip Sync)" },
  },
  {
    sourceDir: "nizima_official_shikoku_metan_ahirushiki",
    sourceBase: "shikoku_metan",
    destDir: "shikoku_metan_talk",
    destBase: "shikoku_metan_talk",
    destNames: { ja: "四国めたん（口パク用）", en: "Shikoku Metan (Lip Sync)" },
  },
];

// 基準名に追従してリネームする拡張子。
// どちらも基準名で探されるため、フォルダを複製したら名前も揃える。
const RENAMED_SUFFIXES = [".model3.json", ".live.json"];

const MOUTH_OPEN = "ParamMouthOpenY";

// モーションから外して表情に任せる値。
//
// 表情は切り替えるたびに前のものが止まるため、確実に消える。
// モーションは発言のあいだ流れ続けるため、途中で気持ちが変わっても残る。
// 驚いて出た汗が、笑っている場面まで残って見える。
//
// 同じ値を表情側が持っているものだけを対象にする。表現は失われない。
const MOTION_ONLY_STRIP = ["ParamSweat"];

interface Expression {
  Parameters?: { Id?: string }[];
}

interface Motion {
  Curves?: { Target?: string; Id?: string }[];
  Meta: { CurveCount: number };
}

/** live.json のうち、名前を持つところ。ほかの項目には触らない。 */
interface LiveConfig {
  model?: {
    name?: string;
    names?: Record<string, string>;
  };
}

const apply = process.argv.includes("--apply");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

// 元のファイルはタブ字下げで書かれている。書き戻しでも同じ形を保つ。
// live.json だけはスペース 4 つなので、呼ぶ側で渡す。
function writeJson(
  file: string,
  data: unknown,
  indent: string | number = "\t",
): void {
  fs.writeFileSync(file, JSON.stringify(data, null, indent), "utf-8");
}

/**
 * 画面に出る名前を、複製のものへ書き換える。
 *
 * フォルダとファイルの名前を変えても、live.json の中は元のまま。
 * 直さないと、モデル一覧に同じ名前が 2 つ並ぶ。どちらが複製か分からない。
 *
 * name は nizima LIVE の内部名で、Plugin API が返す Name になる。
 * names は画面に出る名前で、言語ごとに持つ。
 *
 * 書き換えたら true を返す。既に揃っていれば false。
 */
function renameInLive(
  file: string,
  base: string,
  names: Record<string, string>,
): boolean {
  if (!fs.existsSync(file)) {
    console.log(`  live.json が無い: ${path.basename(file)}`);
    return false;
  }

  const data = readJson<LiveConfig>(file);
  if (!data.model) {
    console.log(`  live.json に model が無い: ${path.basename(file)}`);
    return false;
  }

  const model = data.model;
  const settled =
    model.name === base &&
    Object.entries(names).every(([lang, name]) => model.names?.[lang] === name);
  if (settled) return false;

  if (apply) {
    model.name = base;
    // 書いていない言語は残す。こちらが知らないものを消さない。
    model.names = { ...model.names, ...names };
    writeJson(file, data, 4);
  }
  return true;
}

/** 拡張子で選んで、名前順に並べる。 */
function listBySuffix(dir: string, suffix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => path.join(dir, name));
}

/** 表情から口の開きを取り除く。取り除いた件数を返す。 */
function stripMouthOpen(file: string): number {
  const data = readJson<Expression>(file);
  const before = data.Parameters ?? [];
  const after = before.filter((p) => p.Id !== MOUTH_OPEN);
  const removed = before.length - after.length;
  if (removed && apply) {
    data.Parameters = after;
    writeJson(file, data);
  }
  return removed;
}

/** モーションから口の開きのカーブを取り除く。取り除いた件数を返す。 */
function stripMotionMouth(file: string): number {
  const data = readJson<Motion>(file);
  const before = data.Curves ?? [];
  const drop = [MOUTH_OPEN, ...MOTION_ONLY_STRIP];
  const after = before.filter(
    (c) => !(c.Target === "Parameter" && c.Id !== undefined && drop.includes(c.Id)),
  );
  const removed = before.length - after.length;
  if (removed && apply) {
    data.Curves = after;
    // カーブの数は数え直す。
    // セグメントと点の合計は減らさない。多いぶんには読み込みで困らず、
    // 正しく数え直すにはカーブの形式ごとの解釈が要る。
    data.Meta.CurveCount = after.length;
    writeJson(file, data);
  }
  return removed;
}

for (const {
  sourceDir,
  sourceBase,
  destDir,
  destBase,
  destNames,
} of TARGETS) {
  const source = path.join(config.modelsRoot, sourceDir);
  const dest = path.join(config.modelsRoot, destDir);

  console.log(`\n=== ${sourceDir} → ${destDir}`);

  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    console.log(`  元フォルダが無い: ${source}`);
    continue;
  }

  // 複製先が既にあるなら、中の表情とモーションだけを処理し直す。
  const already = fs.existsSync(dest);
  if (already) {
    console.log("  複製先が既にある。中身だけ見直す");
  } else {
    if (apply) fs.cpSync(source, dest, { recursive: true });
    console.log("  フォルダを複製");
  }

  // 基準名に追従するファイルの改名。複製した直後だけ行う。
  if (!already && sourceBase !== destBase) {
    for (const suffix of RENAMED_SUFFIXES) {
      const old = path.join(dest, `${sourceBase}${suffix}`);
      const renamed = path.join(dest, `${destBase}${suffix}`);
      if (apply) {
        if (!fs.existsSync(old)) {
          console.log(`  改名の対象が無い: ${path.basename(old)}`);
          continue;
        }
        fs.renameSync(old, renamed);
      } else if (!fs.existsSync(path.join(source, `${sourceBase}${suffix}`))) {
        console.log(`  改名の対象が無い: ${sourceBase}${suffix}`);
        continue;
      }
      console.log(`  改名 ${sourceBase}${suffix} → ${destBase}${suffix}`);
    }
  }

  // 画面に出る名前を複製のものへ直す。
  // 下見で複製先がまだ無いときは、元のファイルを見て要否だけ出す。
  const liveFile =
    apply || already
      ? path.join(dest, `${destBase}.live.json`)
      : path.join(source, `${sourceBase}.live.json`);
  console.log(
    renameInLive(liveFile, destBase, destNames)
      ? `  画面に出る名前を直す: ${destNames.ja}`
      : "  画面に出る名前は直っている",
  );

  // 読む先。まだ複製していない下見のときは元を見る。
  const motionRoot = path.join(apply || already ? dest : source, "motion");

  // 表情から口の開きを外す。
  let expressionFiles = 0;
  let expressionRemoved = 0;
  for (const file of listBySuffix(motionRoot, ".exp3.json")) {
    const removed = stripMouthOpen(file);
    if (removed) {
      expressionFiles += 1;
      expressionRemoved += removed;
    }
  }
  console.log(
    `  口の開きを外した表情: ${expressionFiles} 件 / 項目 ${expressionRemoved} 個`,
  );

  // モーションから口の開きのカーブを外す。
  let motionFiles = 0;
  let motionRemoved = 0;
  for (const file of listBySuffix(motionRoot, ".motion3.json")) {
    const removed = stripMotionMouth(file);
    if (removed) {
      motionFiles += 1;
      motionRemoved += removed;
    }
  }
  console.log(
    `  口の開きを外したモーション: ${motionFiles} 件 / カーブ ${motionRemoved} 本`,
  );
}

if (!apply) {
  console.log("\n--- 何も書き換えていない。実行するには --apply を付ける。");
}
