// 表情・モーションと口パクの競合を切り分ける確認用スクリプト。
//
// 表情を出したまま口を開き続け、画面で口が動くかを見る。
// 表情だけ・モーションだけ・両方を切り替えられる。
// 表情が口のパラメータを握っているなら、口は開かないまま止まる。
//
//   npx tsx src/probe/probe-mouth.ts <感情名> <モード> [モデル名] [秒数] [口の値] [送り先]
//   例: npx tsx src/probe/probe-mouth.ts surprise both shikoku_metan 6 1 live
//
// モード: none（口だけ） / expression（表情のみ） / motion（モーションのみ） / both
//
// 口の値に 0 を渡すと「閉じる指示」を送り続ける。
// 表情を出したまま 0 を送って口が開いたままなら、表情が口パクに勝っている。
//
// 送り先の書き方は次の 3 通り。
//   live            LiveParameter の MouthOpen へ送る（既定）
//   cubism          CubismParameter の ParamMouthOpenY へ直接送る
//   live:<Id>       任意の LiveParameter へ送る（例 live:LipSyncMouthOpen）
//   cubism:<Id>     任意の CubismParameter へ送る
import { NizimaClient } from "../core/nizima-client.js";
import { resolveEmotion, resetEmotion } from "../core/emotion.js";
import { resolveModelIds } from "../core/speak-core.js";

type Mode = "none" | "expression" | "motion" | "both";

const emotionName = process.argv[2] ?? "surprise";
const mode = (process.argv[3] ?? "both") as Mode;
const modelName = process.argv[4];
const seconds = Number.parseFloat(process.argv[5] ?? "6");
const mouthValue = Number.parseFloat(process.argv[6] ?? "1");
// 送り先の指定を「経路」と「パラメータ Id」に分ける。
const channelArg = process.argv[7] ?? "live";
const [channel, explicitId] = channelArg.split(":");
const paramId =
  explicitId ?? (channel === "cubism" ? "ParamMouthOpenY" : "MouthOpen");

if (!["none", "expression", "motion", "both"].includes(mode)) {
  console.error(`不明なモード: ${mode}`);
  process.exit(1);
}

const client = new NizimaClient();
await client.connect();

// モデルの解決。名前を省いたら現在選択中のものを使う。
let modelId: string;
let resolvedName = modelName ?? "(current)";
if (modelName) {
  const ids = await resolveModelIds(client);
  const found = ids.get(modelName);
  if (!found) {
    console.error(`モデルが見つからない: ${modelName}`);
    console.error(`画面上のモデル: ${[...ids.keys()].join(", ")}`);
    process.exit(1);
  }
  modelId = found;
} else {
  const current = (await client.request("GetCurrentModelId")) as {
    ModelId: string;
  };
  modelId = current.ModelId;
  const ids = await resolveModelIds(client);
  for (const [name, id] of ids) {
    if (id === modelId) resolvedName = name;
  }
}

console.log(`対象モデル: ${resolvedName} (${modelId})`);
console.log(
  `感情: ${emotionName} / モード: ${mode} / ${seconds} 秒 / 値=${mouthValue} / 送り先=${channel}:${paramId}`,
);

// 前の表情を持ち越さない。
await resetEmotion(client, modelId);
await new Promise((resolve) => setTimeout(resolve, 300));

const mapping = resolveEmotion(resolvedName, emotionName);
if (!mapping && mode !== "none") {
  console.error(`感情の割り当てが無い: ${emotionName}`);
  process.exit(1);
}

if ((mode === "expression" || mode === "both") && mapping?.expression) {
  const expressions = (await client.request("GetExpressions", {
    ModelId: modelId,
  })) as { Expressions: Array<{ Name: string; ExpressionPath: string }> };
  const found = expressions.Expressions.find(
    (e) => e.Name === mapping.expression,
  );
  if (found) {
    await client.request("StartExpression", {
      ModelId: modelId,
      ExpressionPath: found.ExpressionPath,
    });
    console.log(`表情を再生: ${mapping.expression}`);
  } else {
    console.log(`表情が見つからない（飛ばす）: ${mapping.expression}`);
  }
}

if ((mode === "motion" || mode === "both") && mapping?.motion) {
  const motions = (await client.request("GetMotions", {
    ModelId: modelId,
  })) as { Motions: Array<{ Name?: string; MotionPath?: string }> };
  const found = motions.Motions.find((m) => m.Name === mapping.motion);
  if (found?.MotionPath) {
    await client.request("StartMotion", {
      ModelId: modelId,
      MotionPath: found.MotionPath,
    });
    console.log(`モーションを再生: ${mapping.motion}`);
  } else {
    console.log(`モーションが見つからない（飛ばす）: ${mapping.motion}`);
  }
}

// 口パクと同じ経路・同じ間隔で MouthOpen を送り続ける。
// speak-core.ts の口パクループと条件を揃える。
const MOUTH_INTERVAL_MS = 120;
let sent = 0;
let failed = 0;
const timer = setInterval(() => {
  const sending =
    channel === "cubism"
      ? client.request("SetCubismParameterValues", {
          ModelId: modelId,
          CubismParameterValues: [{ Id: paramId, Value: mouthValue }],
        })
      : client.request("SetLiveParameterValues", {
          ModelId: modelId,
          Overwrite: true,
          LiveParameterValues: [{ Id: paramId, Value: mouthValue }],
        });
  sending
    .then(() => {
      sent += 1;
    })
    .catch((error: unknown) => {
      failed += 1;
      if (failed === 1) {
        console.error(
          `送信に失敗: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
}, MOUTH_INTERVAL_MS);

// 維持している最中に、モデル側の口のパラメータを覗けるか試す。
// この API があるかは未確認。あれば画面を見なくても競合を数値で判定できる。
await new Promise((resolve) => setTimeout(resolve, 2000));
try {
  const values = (await client.request("GetCubismParameterValues", {
    ModelId: modelId,
  })) as { CubismParameterValues?: Array<{ Id: string; Value: number }> };
  const mouth = (values.CubismParameterValues ?? []).filter((p) =>
    /Mouth/i.test(p.Id),
  );
  console.log(`GetCubismParameterValues は使えた。口のパラメータ:`);
  for (const p of mouth) console.log(`  ${p.Id} = ${p.Value}`);
} catch (error) {
  console.log(
    `GetCubismParameterValues は使えない: ${error instanceof Error ? error.message : String(error)}`,
  );
}

await new Promise((resolve) => setTimeout(resolve, seconds * 1000 - 2000));
clearInterval(timer);

console.log(`送信 ${sent} 件 / 失敗 ${failed} 件`);

await client
  .request("SetLiveParameterValues", {
    ModelId: modelId,
    LiveParameterValues: [{ Id: "MouthOpen", Value: 0 }],
  })
  .catch(() => {});
await resetEmotion(client, modelId);

client.close();
