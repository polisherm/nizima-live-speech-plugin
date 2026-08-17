import { NizimaClient } from "../core/nizima-client.js";

interface ModelInfo {
  ModelId: string;
  Name?: string;
}

interface ExpressionInfo {
  Name: string;
  ExpressionPath: string;
  Active: boolean;
}

interface MotionInfo {
  Name?: string;
  MotionPath?: string;
  [key: string]: unknown;
}

/**
 * 接続確認コマンド。
 * 現在のモデルと、その表情・モーションの一覧を表示する。
 * 感情表現に使える素材の在庫確認が目的。
 */
async function status(): Promise<void> {
  const client = new NizimaClient();

  console.log("nizima LIVE に接続中...");
  await client.connect();
  console.log("接続・認証 OK");

  const models = (await client.request("GetModels")) as { Models: ModelInfo[] };
  console.log(`\nモデル: ${models.Models.length} 体`);
  for (const model of models.Models) {
    console.log(`  - ${model.Name ?? "(名前なし)"} [${model.ModelId}]`);
  }

  const current = (await client.request("GetCurrentModelId")) as {
    ModelId: string;
  };
  console.log(`\n現在のモデル: ${current.ModelId}`);

  const expressions = (await client.request("GetExpressions", {
    ModelId: current.ModelId,
  })) as { Expressions: ExpressionInfo[] };
  console.log(`\n表情: ${expressions.Expressions.length} 件`);
  for (const expression of expressions.Expressions) {
    const active = expression.Active ? " (再生中)" : "";
    console.log(`  - ${expression.Name}${active}`);
    console.log(`      path: ${expression.ExpressionPath}`);
  }

  const motions = (await client.request("GetMotions", {
    ModelId: current.ModelId,
  })) as { Motions: MotionInfo[] };
  console.log(`\nモーション: ${motions.Motions.length} 件`);
  for (const motion of motions.Motions) {
    console.log(`  - ${JSON.stringify(motion)}`);
  }

  client.close();
}

const command = process.argv[2] ?? "status";

switch (command) {
  case "status":
    status().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
    break;
  default:
    console.error(`unknown command: ${command} (available: status)`);
    process.exit(1);
}
