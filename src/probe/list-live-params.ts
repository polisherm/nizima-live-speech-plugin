// LiveParameter の一覧を表示する確認用スクリプト。
// 口パクに使うパラメータの実 ID を確かめる。
import { NizimaClient } from "../core/nizima-client.js";

const client = new NizimaClient();
await client.connect();

const result = (await client.request("GetLiveParameters")) as {
  LiveParameters: Array<{
    Id: string;
    Group?: string;
    Name?: string;
    Min?: number;
    Max?: number;
    Base?: number;
  }>;
};

console.log(`LiveParameter: ${result.LiveParameters.length} 件`);
for (const parameter of result.LiveParameters) {
  const range = `[${parameter.Min ?? "?"}..${parameter.Max ?? "?"}]`;
  console.log(
    `  ${parameter.Id} ${range} ${parameter.Name ?? ""} (${parameter.Group ?? "-"})`,
  );
}

client.close();
