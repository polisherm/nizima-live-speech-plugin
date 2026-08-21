// 画面の隅に、声のクレジットを置く。
//
// VOICEVOX の利用規約は、利用したことが分かるクレジット表記を求めている
// （https://voicevox.hiroshiba.jp/term/）。
// 商用・非商用を問わず条件になっており、公開の範囲による例外は書かれていない。
// 人に見せるものには入れておく。
//
// キャラクター側のガイドラインは、これとは別に緩い。
// 東北ずん子・ずんだもんプロジェクトは「コピーライト表記(c)は必要ありません」
// としており、四国めたんもずんだもんもその対象になる
// （https://zunko.jp/guideline.html）。
// 両方を満たすには、VOICEVOX の表記だけあればよい。
//
// 台詞の字幕と違い、内容は変わらない。
// 置いたままにして、喋る処理からは切り離す。
// nizima の画面で手で動かせるので、位置と大きさは目で合わせられる。
import path from "node:path";
import { tmpdir } from "node:os";
import type { NizimaClient } from "../nizima/client.js";
import type {
  AddItemResponse,
  GetCurrentSceneIdResponse,
  GetItemsResponse,
  ItemInfo,
} from "../nizima/types.js";
import { renderImage } from "./subtitle.js";

/**
 * 文言は呼ぶ側が渡す。
 *
 * 書き方の指定は「VOICEVOX を利用したことがわかる」だけで、形は決まっていない。
 * 音源の名前まで書く形が案内されているため、それに合わせる。
 *
 * ここで組み立てない。誰が喋るかを知っているのは呼ぶ側で、
 * ここが知りに行くと、画面へ出す側がモデルの定義を読むことになる。
 *
 * 区切りに / を使わない。字幕では折り返してよい位置の印にしてあり、
 * 描く側がそこで行を割ろうとする。
 */

/** 描く大きさ。字幕より小さく、目立たせない。 */
const FONT_SIZE = 48;
const IMAGE_WIDTH = 1400;
const MAX_LINES = 1;

/** 文字色。背景が明るいので、白よりも読める灰色にする。 */
const COLOR = "#E8E8E8";

/**
 * 画面上の位置。-1 が左端と下端。
 *
 * 台詞の字幕は下の中央に出る。重ならないよう、左の下寄りへ置く。
 */
const POSITION_X = -0.71;
const POSITION_Y = -0.92;

/**
 * 表示倍率。
 *
 * 字幕は 2 行の画像に 0.17 を当てている。同じ感覚でこの 1 行の画像に
 * 0.09 を当てたところ、画面の幅を超えた。行数が違うと見え方が変わる。
 *
 * 何で決まるかは確かめていない。値は画面で合わせて決めた。
 * アイテムは nizima 上で手でも動かせるので、目で合わせてから寄せてある。
 */
const ITEM_SCALE = 0.038;

/**
 * 画像の置き場。
 *
 * 消すときに、この名前でアイテムを見分ける。
 * プロセスごとに変えると、別のプロセスが出したものを消せない。
 */
const IMAGE_PATH = path.join(tmpdir(), "nizima-agent-bridge-credit.png");

/** いま開いているシーンの ID。 */
async function currentSceneId(client: NizimaClient): Promise<string> {
  const scene =
    await client.request<GetCurrentSceneIdResponse>("GetCurrentSceneId");
  return scene.SceneId;
}

/** 画面に出ているアイテムを取る。 */
async function listItems(
  client: NizimaClient,
  sceneId: string,
): Promise<ItemInfo[]> {
  const result = await client
    .request<GetItemsResponse>("GetItems", { SceneId: sceneId })
    .catch(() => null);
  return result?.Items ?? [];
}

/** クレジットとして出したアイテムを探す。画像の置き場で見分ける。 */
function findCredits(items: ItemInfo[]): ItemInfo[] {
  const target = IMAGE_PATH.replace(/\\/g, "/").toLowerCase();
  return items.filter(
    (item) => (item.ItemPath ?? "").replace(/\\/g, "/").toLowerCase() === target,
  );
}

/**
 * クレジットを画面に出す。すでに出ていれば、置き直さない。
 *
 * 位置と大きさを送るのは、出した直後の 1 回だけにする。
 * 毎回送ると、手で動かした位置が元へ戻ってしまう。
 */
export async function showCredit(
  client: NizimaClient,
  text: string,
): Promise<boolean> {
  const sceneId = await currentSceneId(client);
  const already = findCredits(await listItems(client, sceneId));
  if (already.length > 0) return false;

  await renderImage(text, IMAGE_PATH, COLOR, {
    fontSize: FONT_SIZE,
    width: IMAGE_WIDTH,
    maxLines: MAX_LINES,
  });

  const added = await client.request<AddItemResponse>("AddItem", {
    SceneId: sceneId,
    ItemPath: IMAGE_PATH,
  });

  await client.request("MoveItem", {
    ItemId: added.ItemId,
    Absolute: true,
    PositionX: POSITION_X,
    PositionY: POSITION_Y,
    Scale: ITEM_SCALE,
    Rotation: 0,
  });

  return true;
}

/** クレジットを画面から消す。消した数を返す。 */
export async function hideCredit(client: NizimaClient): Promise<number> {
  const sceneId = await currentSceneId(client);
  const targets = findCredits(await listItems(client, sceneId));
  for (const item of targets) {
    await client
      .request("RemoveItem", { ItemId: item.ItemId })
      .catch(() => {});
  }
  return targets.length;
}
