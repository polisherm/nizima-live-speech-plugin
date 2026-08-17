// 素の姿へ戻すための待機モーションを作る。
//
//   npx tsx src/setup/make-idle-motion.ts [モデル名...]
//
// モーションが動かした値は、そのモーションを止めても既定へ戻らない。
// 止めると一段で飛び、ループを切っても最後の値で固まる。
// 戻す道は別のモーションへ乗り換えることだけで、乗り換えならフェードがかかる。
//
// ただしフェードするのは、新しいモーションが持つ値だけ。
// 持たない値は前のまま残る。驚いた目や汗が残り続けるのはこれが理由。
//
// そこで、全モーションが触る値をすべて集め、それを既定のまま保つモーションを作る。
// これへ乗り換えれば、顔も体もまとめて素へ戻る。
//
// 口の開きだけは入れない。そこは口パクの持ち場で、モーションに触らせない。
import fs from "node:fs";
import path from "node:path";
import { NizimaClient } from "../core/nizima-client.js";

/** 口パクに任せる値。待機モーションからも外す。 */
const MOUTH_OPEN = "ParamMouthOpenY";

/**
 * 待機モーションで戻さない値。
 *
 * 戻したいのは、驚いた目や汗のように「顔に貼りついたまま残る」もの。
 * 首の向きや腕の位置まで戻すと、喋り終えた瞬間に正面へ引き戻されて、
 * 話の流れと関係のない動きが挟まる。
 *
 * 姿勢と揺れものは、そのままにしておくほうが自然につながる。
 */
const KEEP_AS_IS =
  /Angle|Body|Arm|Hand|Leg|Foot|Hair|Ear|Tail|Breath|Physics|Bust|Shoulder|Neck/;

/** 作るモーションの名前と長さ。値は動かないので、長さは短くてよい。 */
const IDLE_NAME = "mtn_idle";
const DURATION = 1;
const FPS = 30;
const FADE_SEC = 0.5;

const client = new NizimaClient();
await client.connect();

const models = (await client.request("GetModels")) as {
  Models: Array<{ ModelId: string; Name?: string; ModelPath?: string }>;
};

const wanted = process.argv.slice(2);

for (const model of models.Models) {
  const modelPath = model.ModelPath;
  if (!modelPath) continue;
  const folder = path.dirname(modelPath);
  const folderName = path.basename(folder);
  if (wanted.length && !wanted.includes(folderName)) continue;

  console.log(`\n=== ${folderName}`);

  // モーションが動かす値をすべて集める。
  const motionDir = path.join(folder, "motion");
  const targets = new Set<string>();
  let scanned = 0;
  for (const file of fs.readdirSync(motionDir)) {
    if (!file.endsWith(".motion3.json")) continue;
    if (file.startsWith(IDLE_NAME)) continue;
    const data = JSON.parse(fs.readFileSync(path.join(motionDir, file), "utf-8"));
    for (const curve of data.Curves ?? []) {
      if (curve.Target !== "Parameter") continue;
      if (curve.Id === MOUTH_OPEN) continue;
      if (KEEP_AS_IS.test(curve.Id)) continue;
      targets.add(curve.Id);
    }
    scanned += 1;
  }
  console.log(`  モーション ${scanned} 件から ${targets.size} 個の値を集めた`);

  // 既定値を引く。moc3 の中にあるため、nizima から取る。
  const defs = (await client.request("GetCubismParameters", {
    ModelId: model.ModelId,
  })) as { CubismParameters?: Array<{ Id: string; DefaultValue: number }> };
  const defaults = new Map(
    (defs.CubismParameters ?? []).map((p) => [p.Id, p.DefaultValue]),
  );

  // 値を既定のまま保つカーブを並べる。
  // Segments は [開始の時刻, 開始の値, 種別, 終わりの時刻, 終わりの値] の並び。
  // 種別 0 は直線で、引数を 2 つ取り、点を 1 つ足す。
  const curves = [...targets]
    .filter((id) => defaults.has(id))
    .map((id) => ({
      Target: "Parameter",
      Id: id,
      Segments: [0, defaults.get(id)!, 0, DURATION, defaults.get(id)!],
    }));

  const idle = {
    Version: 3,
    Meta: {
      Duration: DURATION,
      Fps: FPS,
      Loop: true,
      AreBeziersRestricted: true,
      CurveCount: curves.length,
      // 直線が 1 本ずつなので、区間は本数と同じ。点は始点と終点で 2 つ。
      TotalSegmentCount: curves.length,
      TotalPointCount: curves.length * 2,
      UserDataCount: 0,
    },
    Curves: curves,
  };

  const outPath = path.join(motionDir, `${IDLE_NAME}.motion3.json`);
  fs.writeFileSync(outPath, JSON.stringify(idle, null, "\t"), "utf-8");
  console.log(`  書き出した: ${path.basename(outPath)}（カーブ ${curves.length} 本）`);

  // model3.json に登録する。ここに載っていないと一覧に出ない。
  const model3Path = modelPath;
  const model3 = JSON.parse(fs.readFileSync(model3Path, "utf-8"));
  const groups = model3.FileReferences.Motions;
  const groupName = Object.keys(groups)[0] ?? "";
  const entries = groups[groupName] ?? [];
  const relative = `motion/${IDLE_NAME}.motion3.json`;
  if (entries.some((e: any) => e.File === relative)) {
    console.log(`  登録済み`);
  } else {
    entries.push({
      File: relative,
      FadeInTime: FADE_SEC,
      FadeOutTime: FADE_SEC,
    });
    groups[groupName] = entries;
    fs.writeFileSync(model3Path, JSON.stringify(model3, null, "\t"), "utf-8");
    console.log(`  model3.json に登録した`);
  }
}

client.close();
