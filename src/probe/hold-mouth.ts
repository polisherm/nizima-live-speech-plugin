// 口を開いた状態で数秒維持する確認用スクリプト。
// 口パクが見えないとき、値がモデルまで届いているかを切り分ける。
//
//   npx tsx src/probe/hold-mouth.ts [パラメータ Id] [値] [秒数] [モデル名]
import { NizimaClient } from "../core/nizima-client.js";
import type { GetLiveParameterValuesResponse } from "../core/nizima-types.js";
import { MOUTH_INTERVAL_MS } from "../core/speak-core.js";
import { resolveTarget, wait } from "./shared.js";

const paramId = process.argv[2] ?? "MouthOpen";
const value = Number.parseFloat(process.argv[3] ?? "1");
const seconds = Number.parseFloat(process.argv[4] ?? "5");

const client = new NizimaClient();
await client.connect();

const target = await resolveTarget(client, process.argv[5]);

console.log(`対象モデル: ${target.name} (${target.modelId})`);
console.log(`${paramId} = ${value} を ${seconds} 秒維持する`);

// 本番と同じ間隔で送る。届き方の違いを条件のせいにしないため。
const timer = setInterval(() => {
  client
    .request("SetLiveParameterValues", {
      ModelId: target.modelId,
      Overwrite: true,
      LiveParameterValues: [{ Id: paramId, Value: value }],
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
}, MOUTH_INTERVAL_MS);

await wait(seconds * 1000);
clearInterval(timer);

const after = await client.request<GetLiveParameterValuesResponse>(
  "GetLiveParameterValues",
  { ModelId: target.modelId },
);

const actual = after.LiveParameterValues.find((p) => p.Id === paramId);
console.log(`維持終了。nizima 側の現在値: ${JSON.stringify(actual)}`);

client.close();
