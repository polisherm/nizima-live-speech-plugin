// 確かめる道具どうしで重なる処理。
//
// どれも「モデルを 1 体決めて、値を読んで、既定と見比べる」形になる。
// 同じ手順を各ファイルに書き写すと、測り方が少しずつ食い違う。

import type { NizimaClient } from "../nizima/client.js";
import type {
  GetCubismParameterValuesResponse,
  GetCubismParametersResponse,
  GetCurrentModelIdResponse,
} from "../nizima/types.js";
import { resolveModelIds } from "../perform/speak.js";

/** 対象に決めたモデル。表示にも使うので名前を添える。 */
export interface TargetModel {
  modelId: string;
  /** 画面上の名前。現在のモデルを使ったときは、その ID から引き直したもの。 */
  name: string;
}

/**
 * 対象のモデルを 1 体決める。
 *
 * 名前を渡せばそれを探す。省いたら、いま選ばれているモデルを使う。
 * 見つからなければ、画面のモデル名を並べて終わる。
 */
export async function resolveTarget(
  client: NizimaClient,
  name?: string,
): Promise<TargetModel> {
  const ids = await resolveModelIds(client);

  if (name) {
    const found = ids.get(name);
    if (!found) {
      console.error(`モデルが見つからない: ${name}`);
      console.error(`画面上のモデル: ${[...ids.keys()].join(", ")}`);
      process.exit(1);
    }
    return { modelId: found, name };
  }

  const current =
    await client.request<GetCurrentModelIdResponse>("GetCurrentModelId");
  let resolved = "(current)";
  for (const [candidate, id] of ids) {
    if (id === current.ModelId) resolved = candidate;
  }
  return { modelId: current.ModelId, name: resolved };
}

/** パラメータの既定値を引く。ずれを測る土台にする。 */
export async function readDefaults(
  client: NizimaClient,
  modelId: string,
): Promise<Map<string, number>> {
  const defs = await client.request<GetCubismParametersResponse>(
    "GetCubismParameters",
    { ModelId: modelId },
  );
  return new Map(
    (defs.CubismParameters ?? []).map((p) => [p.Id, p.DefaultValue]),
  );
}

/** 既定値から離れているパラメータ 1 つぶん。 */
export interface Drift {
  id: string;
  /** 既定値との差。符号は残す。どちらへ振れたかが分かる。 */
  diff: number;
}

/** 既定値からのずれ。 */
export interface DriftReport {
  items: Drift[];
  /** ずれている数。 */
  count: number;
  /** ずれの合計。符号は落として足す。 */
  total: number;
}

/** ずれと見なす幅。これ以下は誤差として捨てる。 */
const DRIFT_THRESHOLD = 0.01;

/**
 * いまの値を読み、既定値から離れているものを集める。
 *
 * only を渡すと、その名前に当たるパラメータだけを見る。
 * 顔まわりだけを追いたいときに使う。
 */
export async function readDrift(
  client: NizimaClient,
  modelId: string,
  defaults: Map<string, number>,
  only?: RegExp,
): Promise<DriftReport> {
  const values = await client
    .request<GetCubismParameterValuesResponse>("GetCubismParameterValues", {
      ModelId: modelId,
    })
    .catch(() => null);

  const items: Drift[] = [];
  let total = 0;
  for (const p of values?.CubismParameterValues ?? []) {
    if (only && !only.test(p.Id)) continue;
    const base = defaults.get(p.Id);
    if (base === undefined) continue;
    const diff = p.Value - base;
    if (Math.abs(diff) <= DRIFT_THRESHOLD) continue;
    items.push({ id: p.Id, diff });
    total += Math.abs(diff);
  }
  return { items, count: items.length, total };
}

/** 指定したミリ秒だけ待つ。 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
