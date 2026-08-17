import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import type { NizimaClient } from "./nizima-client.js";
import {
  stripSpacesAroundJapanese,
  stripRubyForSubtitle,
} from "./format-speech.js";
import { PwshWorker } from "./pwsh-worker.js";

/**
 * 台詞を画像にして、nizima LIVE の画面上に字幕として置く。
 *
 * nizima の「OBS 字幕出力」は AI アシスタント機能の応答しか出さず、
 * しかも表示するのは OBS 側になる。画面に直接出したいので、
 * Plugin API のアイテム機能（任意の画像を配置できる）を使う。
 *
 * アイテムは画像を大きく引き伸ばして表示する。
 * 画像を小さく作ると拡大でぼやけるため、高い解像度で描いて Scale で縮める。
 */

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "render-subtitle.ps1",
);

/**
 * 描画する画像の幅。フォントサイズとの比で 1 行の文字数が決まる。
 *
 * 表示上の大きさは画像のピクセル数では決まらない（ITEM_SCALE を参照）。
 * 大きく描くほど拡大率が下がり、輪郭のギザつきが減る。
 */
const IMAGE_WIDTH = 2560;

/** 描画するフォントサイズ。IMAGE_WIDTH と比例させる。 */
const FONT_SIZE = 96;

/**
 * 字幕の行数。画像の高さはこれで固定される。
 *
 * nizima は画像全体を一定の大きさに収めて表示する。
 * 台詞の長さで画像が縦に伸びると、その分だけ文字が縮んで読めなくなる。
 * 行数を固定して画像サイズを一定に保つ。
 *
 * 台詞は 1 行に収まる長さで区切って渡すため、2 行目は保険として残す。
 */
const MAX_LINES = 2;

/**
 * 画面上の表示倍率。
 *
 * 表示の大きさは画像のピクセル数では決まらない。
 * 画面上の横幅は「画像の横÷縦」に ITEM_SCALE を掛けた値で決まる。
 * 画像を横長にするほど横に伸びるため、行数を変えたらここも見直す。
 */
const ITEM_SCALE = 0.17;

/**
 * 字幕 1 枚に入る文字数の上限。話者名を含めた数で数える。
 *
 * 何文字入るかは、字の幅で変わる。実測では 2 行に、
 * かなだけなら 46 文字、漢字だけなら 39 文字しか入らない。
 *
 * 数で決める以上、狭いほうに合わせるしかない。
 * 超えた分は画面から消えるので、余らせるより確実に収める。
 *
 * 話者名を含めるのは、画面に出るのが「めたん: 本文」の形だから。
 * 本文だけで数えると、名前のぶんだけ超えて末尾が消える。
 *
 * 短くしすぎると、続いている一文が別々の字幕に割れる。
 * 「設定を一つ間違えると、」のような途中の句が単独で出て、区切りすぎに見える。
 */
export const SUBTITLE_MAX_CHARS = 38;


/**
 * 画面上の縦位置。-1 が下端。
 *
 * 下端に寄せすぎない。モデルが複数あるとき、画面下部に切り替え用の UI が出て重なる。
 */
const POSITION_Y = -0.62;

/**
 * 字幕の画像を作り続ける常駐プロセス。
 *
 * 描画のたびに pwsh を起動すると、1 回あたり 400〜500ms を払う。
 * 台詞は区切りごとに差し替えるため、その数だけ待ち時間が積み上がる。
 *
 * 描画そのものは既存のスクリプトに任せる。
 * & で呼ぶと同じプロセスの中で動くため、起動は最初の 1 回で済む。
 */
const RENDER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$renderer = '${SCRIPT_PATH.replace(/\\/g, "/")}'`,
  "while ($true) {",
  "  $line = [Console]::In.ReadLine()",
  "  if ([string]::IsNullOrEmpty($line)) { break }",
  "  try {",
  "    $req = $line | ConvertFrom-Json",
  "    & $renderer -Text $req.Text -OutPath $req.OutPath " +
    "-FontSize $req.FontSize -Width $req.Width -MaxLines $req.MaxLines " +
    "-Color $req.Color | Out-Null",
  "    [Console]::Out.WriteLine('done')",
  "  } catch {",
  "    [Console]::Out.WriteLine('error')",
  "  }",
  "}",
].join("; ");

const renderer = new PwshWorker(RENDER_SCRIPT);

/** 常駐プロセスを終う。字幕を使い終えたら呼ぶ。 */
export function closeSubtitleRenderer(): void {
  renderer.close();
}

/**
 * 描画の準備を先に済ませる。
 *
 * プロセスを起こすだけでは足りない。
 * 図形描画とフォントの読み込みは、最初に 1 枚描いたときにまとめて起きる。
 * 捨てる 1 枚を描いておけば、台詞の 1 つ目で待たされない。
 */
export async function warmUpSubtitleRenderer(): Promise<void> {
  const throwaway = path.join(tmpdir(), `nizima-subtitle-warmup-${process.pid}.png`);
  await renderImage("あ", throwaway, "#FFFFFF").catch(() => {});
  rmSync(throwaway, { force: true });
}

/**
 * 字幕を画面に出す準備を済ませる。
 *
 * 1 枚目を出すときだけ、nizima 側で画像の読み込みが起きる。
 * そのぶん、追加してから位置が届くまでが延びて、
 * 既定の位置と大きさのまま画面の真ん中に出たあと、定位置へ縮む。
 *
 * 喋り出す前に 1 枚出し入れして、その重さを先に払っておく。
 * 捨てる 1 枚は画面の外に置くため、目には映らない。
 */
export async function warmUpSubtitleItem(client: NizimaClient): Promise<void> {
  const imagePath = path.join(
    tmpdir(),
    `nizima-subtitle-warmup-item-${process.pid}.png`,
  );
  try {
    await renderImage("あ", imagePath, "#FFFFFF");
    const scene = (await client.request("GetCurrentSceneId")) as {
      SceneId: string;
    };
    const added = (await client.request("AddItem", {
      SceneId: scene.SceneId,
      ItemPath: imagePath,
    })) as { ItemId: string };
    // 画面の外へ逃がしてから消す。一瞬でも見せない。
    await client
      .request("MoveItem", {
        ItemId: added.ItemId,
        Absolute: true,
        PositionX: 0,
        PositionY: -3,
        Scale: ITEM_SCALE,
        Rotation: 0,
      })
      .catch(() => {});
    await client.request("RemoveItem", { ItemId: added.ItemId }).catch(() => {});
  } catch {
    // 準備なので、できなくても先へ進む。
  }
  rmSync(imagePath, { force: true });
}

/**
 * 文字を画像にする。
 *
 * 大きさは変えられる。字幕のほかに、隅へ置くクレジットも同じ道具で描く
 * （credit.ts を参照）。描く仕組みを 2 つ持つと、片方だけ直す事故が起きる。
 */
export async function renderImage(
  text: string,
  outPath: string,
  color: string,
  options: { fontSize?: number; width?: number; maxLines?: number } = {},
): Promise<void> {
  renderer.send(
    JSON.stringify({
      Text: text,
      OutPath: outPath,
      FontSize: options.fontSize ?? FONT_SIZE,
      Width: options.width ?? IMAGE_WIDTH,
      MaxLines: options.maxLines ?? MAX_LINES,
      Color: color,
    }),
  );
  const startedAt = Date.now();
  const result = await renderer.nextLine();
  renderElapsedMs += Date.now() - startedAt;
  if (result !== "done") {
    throw new Error(`字幕の描画に失敗 (${result})`);
  }
}

/** 描画を待った時間の合計（ミリ秒）。ここが延びると台詞の切れ目で待ちが出る。 */
let renderElapsedMs = 0;

export function takeRenderElapsedMs(): number {
  const elapsed = renderElapsedMs;
  renderElapsedMs = 0;
  return elapsed;
}

/**
 * 追加してから位置が届くまでの、いちばん長かった時間（ミリ秒）。
 *
 * この間だけ、字幕が既定の位置に出たままになる。
 * 機械が混むと延び、画面の中央から飛んでくるように見える。
 */
let placeElapsedMs = 0;

export function takePlaceElapsedMs(): number {
  const elapsed = placeElapsedMs;
  placeElapsedMs = 0;
  return elapsed;
}

/**
 * 画面に出ている字幕を管理する。
 *
 * 台詞ごとに画像を作り直してアイテムを差し替える。
 * 前のアイテムを消してから次を出すため、2 つ同時には出ない。
 */
export class Subtitle {
  private itemId: string | null = null;
  private imagePath: string | null = null;
  private counter = 0;

  constructor(private readonly client: NizimaClient) {}

  /**
   * 台詞を画面に出す。前の字幕は消える。
   *
   * 話者名はここで付ける。呼び出し側で連結すると、
   * 1 行に入る文字数の計算が名前のぶんだけずれて、末尾が省略される。
   */
  async show(text: string, color = "#FFFFFF", speaker?: string): Promise<void> {
    // ファイル名を毎回変える。同じパスを上書きすると nizima が
    // 前の画像を掴んだままになることがあるため。
    const imagePath = path.join(
      tmpdir(),
      `nizima-subtitle-${process.pid}-${++this.counter}.png`,
    );
    // 折り返しは描画側が実測して決める。
    // こちらで文字数から見積もると、話者名のぶんや文字ごとの幅の差でずれる。
    //
    // ルビは記法を外して表示のほうを出す。読みは音声だけに当てる。
    // 「菓子戦争――スイーツ・ラグナロク――」のような表記は、画面では見せ場になる。
    const cleaned = stripSpacesAroundJapanese(stripRubyForSubtitle(text));
    const body = speaker ? `${speaker}: ${cleaned}` : cleaned;
    await renderImage(body, imagePath, color);

    const scene = (await this.client.request("GetCurrentSceneId")) as {
      SceneId: string;
    };
    const added = (await this.client.request("AddItem", {
      SceneId: scene.SceneId,
      ItemPath: imagePath,
    })) as { ItemId: string };

    // 追加した直後は既定の位置と大きさで置かれる。
    // 位置を指定するまでの間、画面の中央に大きく出る。
    //
    // アイテムを隠したまま追加する方法は無い。
    // 追加は SceneId と ItemPath しか受け取らず、位置も大きさも指定できない。
    // 画像だけ差し替える方法も無いため、台詞ごとに追加と削除を繰り返している。
    //
    // 消せるのは、追加してから位置が届くまでの間だけ。
    // 一度で送って、その間をできるだけ短くする。
    const placeStartedAt = Date.now();
    await this.client.request("MoveItem", {
      ItemId: added.ItemId,
      Absolute: true,
      PositionX: 0,
      PositionY: POSITION_Y,
      Scale: ITEM_SCALE,
      Rotation: 0,
    });
    placeElapsedMs = Math.max(placeElapsedMs, Date.now() - placeStartedAt);

    // 新しい方を出してから前を消す。先に消すと字幕が一瞬途切れる。
    await this.clear();

    this.itemId = added.ItemId;
    this.imagePath = imagePath;
  }

  /** 画面から字幕を消す。 */
  async clear(): Promise<void> {
    if (this.itemId) {
      await this.client
        .request("RemoveItem", { ItemId: this.itemId })
        .catch(() => {});
      this.itemId = null;
    }
    if (this.imagePath) {
      // SUBTITLE_KEEP=1 で残す。出た字幕を後から現物で確かめられる。
      if (process.env.SUBTITLE_KEEP !== "1") {
        try {
          rmSync(this.imagePath, { force: true });
        } catch {
          // 消せなくても実害はない。
        }
      }
      this.imagePath = null;
    }
  }
}
