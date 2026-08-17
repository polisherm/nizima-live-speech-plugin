// 口を開いた状態で数秒維持する確認用スクリプト。
// 口パクが見えないとき、値がモデルまで届いているかを切り分ける。
import { NizimaClient } from "../core/nizima-client.js";

const paramId = process.argv[2] ?? "MouthOpen";
const value = Number.parseFloat(process.argv[3] ?? "1");
const seconds = Number.parseFloat(process.argv[4] ?? "5");

const client = new NizimaClient();
await client.connect();

const current = (await client.request("GetCurrentModelId")) as {
  ModelId: string;
};

console.log(`対象モデル: ${current.ModelId}`);
console.log(`${paramId} = ${value} を ${seconds} 秒維持する`);

const timer = setInterval(() => {
  client
    .request("SetLiveParameterValues", {
      ModelId: current.ModelId,
      Overwrite: true,
      LiveParameterValues: [{ Id: paramId, Value: value }],
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
}, 150);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
clearInterval(timer);

const after = (await client.request("GetLiveParameterValues", {
  ModelId: current.ModelId,
})) as { LiveParameterValues: Array<{ Id: string; Value: number }> };

const actual = after.LiveParameterValues.find((p) => p.Id === paramId);
console.log(`維持終了。nizima 側の現在値: ${JSON.stringify(actual)}`);

client.close();
