// 台本の誤読を直す。
//
//   npx tsx src/cli/fix-readings.ts <台本ファイル>
//
// 読み上げたときの音を VOICEVOX から取り、台詞と並べてモデルに見せる。
// 意味と合っていない語が見つかれば、その語に読みを付けて書き戻す。
//
// 喋らせながらやると、台詞 1 つあたりの生成が倍になり、
// 先読みが再生に間に合わなくなって切れ目で無音が伸びる。
// 台本にしてからまとめて直せば、再生の速さに響かない。
import { readFileSync, writeFileSync } from "node:fs";
import { ROLES } from "../core/roles.js";
import { fixMisreadingsAll, type LineToCheck } from "../core/verify-reading.js";

const target = process.argv[2];
if (!target) {
  console.error("usage: fix-readings.ts <台本ファイル>");
  process.exit(1);
}

const source = readFileSync(target, "utf-8");
const lines = source.replace(/\r\n?/g, "\n").split("\n");

/** 台詞の行だけを拾う。行番号は書き戻すときに使う。 */
const targets: Array<{ at: number; roleName: string }> = [];
const toCheck: LineToCheck[] = [];

for (const [at, line] of lines.entries()) {
  if (line.trim().startsWith("#")) continue;
  const matched = line.match(/^([^:：]+)[:：]\s*(.+)$/);
  if (!matched) continue;
  const roleName = matched[1].trim();
  const role = ROLES[roleName];
  if (!role) continue;
  targets.push({ at, roleName });
  toCheck.push({ text: matched[2].trim(), speakerId: role.speakerId });
}

if (toCheck.length === 0) {
  console.error("台詞の行が見つからなかった");
  process.exit(1);
}

console.log(`${toCheck.length} 台詞の読みを確かめる...`);

const fixed = await fixMisreadingsAll(toCheck);

let changed = 0;
for (const [index, spot] of targets.entries()) {
  const before = toCheck[index].text;
  const after = fixed[index];
  if (after === before) continue;
  console.log(`\n${spot.roleName}:`);
  console.log(`  前: ${before}`);
  console.log(`  後: ${after}`);
  lines[spot.at] = `${spot.roleName}: ${after}`;
  changed += 1;
}

if (changed === 0) {
  console.log("直すところは無かった。");
} else {
  writeFileSync(target, lines.join("\n"), "utf-8");
  console.log(`\n${changed} 行を直して書き戻した: ${target}`);
}
