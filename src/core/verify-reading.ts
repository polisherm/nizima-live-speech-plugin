// 読み上げたときの音を確かめて、誤読があれば直す。
//
// 読み違えやすい語を表に登録していく形は、際限がない。
// 「得」を入れれば次は「潰した」が出る。登録漏れは出てから気づくしかない。
//
// VOICEVOX は合成の前に、実際に読む音を返す。
// その音を台詞と並べて見せれば、どこが違うかは言葉の意味から判断できる。
// 登録という考え方そのものが要らなくなる。
//
// 台本はまとめて 1 回で見せる。台詞ごとに問うと、そのたびに起動を待つ。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { audioQueryKana } from "./voicevox.js";
import { finishReading } from "./format-speech.js";
import { parseLine, toReading } from "./line-parser.js";
import { EMOTIONS } from "./emotion.js";

/** 読みの確認に使うモデル。差し替えは config.local.json の verifyModel で。 */
const MODEL = config.verifyModel;

/**
 * 読みからアクセントの記号を落とす。
 *
 * VOICEVOX が返す音にはアクセントと区切りの印が混ざる。
 * どう読むかだけを見せたいので、かなだけにする。
 */
function bareKana(kana: string): string {
  return kana
    .replace(/[^ァ-ヶー]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 声に出る形を取り出す。表情の指定は声に出ないため、ここには現れない。 */
async function spokenKana(
  text: string,
  speakerId: number,
): Promise<string | null> {
  const segments = parseLine(text, (name) => Boolean(EMOTIONS[name]));
  const spoken = finishReading(
    segments.map((s) => toReading(s.parts)).join(""),
  );
  if (!spoken) return null;
  const kana = await audioQueryKana(spoken, speakerId).catch(() => null);
  return kana ? bareKana(kana) : null;
}

/** ルビを外した形。直しの前後で台詞そのものが変わっていないかを見るのに使う。 */
const stripRuby = (s: string) => s.replace(/\{([^{}|]+)\|[^{}|]+\}/g, "$1");

/** カタカナを母音の段で引く。伸ばす音の書き方を揃えるのに使う。 */
const VOWEL_OF: Record<string, string> = {};
for (const [vowel, chars] of Object.entries({
  a: "アカサタナハマヤラワガザダバパャァヮ",
  i: "イキシチニヒミリギジヂビピィ",
  u: "ウクスツヌフムユルグズヅブプュゥヴ",
  e: "エケセテネヘメレゲゼデベペェヶ",
  o: "オコソトノホモヨロヲゴゾドボポョォ",
})) {
  for (const char of chars) VOWEL_OF[char] = vowel;
}

/**
 * 伸ばす音の書き方を揃える。
 *
 * VOICEVOX は伸ばす音を、直前の母音の字で書く。
 * 「設定」は「セッテエ」、「抵抗」は「テエコオ」になる。
 * 人が読みを書くときは「セッテイ」「テイコウ」と書く。字は違うが声は同じ。
 *
 * 揃えずに比べると、書き方が違うだけの直しが「音が変わった」に見える。
 * 正しく読めている語に読みを付けてしまい、かえって語が割れる。
 */
function normalizeLongVowels(kana: string): string {
  const result: string[] = [];
  let previous = "";
  for (const char of kana) {
    if (char === "ー") {
      result.push("ー");
      continue;
    }
    const long =
      (char === "ア" && previous === "a") ||
      (char === "イ" && (previous === "i" || previous === "e")) ||
      (char === "ウ" && (previous === "u" || previous === "o")) ||
      (char === "エ" && previous === "e") ||
      (char === "オ" && previous === "o");
    if (long) {
      result.push("ー");
      continue;
    }
    result.push(char);
    previous = VOWEL_OF[char] ?? "";
  }
  return result.join("");
}

/**
 * 足された読みの指定が、狙いどおりに効いたかを見る。
 *
 * 漢字を含む語だけを直す形にしていた時期がある。
 * かなに読みを付けても音が変わらないか、かえって崩れることがあるためだった。
 *
 * ところが、かなだけで書かれた誤読がある。
 * 助詞の「は」は「ワ」と読むが、後ろに来る字によっては「ハ」と読まれる。
 * 「ボクはね、」は「ボク ハネ」になる。字はすべてかなで、漢字の有無では拾えない。
 *
 * そこで、字の種類で絞るのをやめる。
 * 代わりに、直した形をもう一度読ませて、指定した読みが音に出たかを確かめる。
 * 出ていれば効いている。出ていなければ受け取られていないので落とす。
 *
 * 語を表に登録する形にはしない。増やし続けることになり、漏れは出てから気づく。
 */
function addedReadingsLanded(
  original: string,
  candidate: string,
  kana: string,
): boolean {
  const all = () => /\{[^{}|]+\|[^{}|]+\}/g;
  const before = new Set(original.match(all()) ?? []);
  const added = (candidate.match(all()) ?? []).filter(
    (ruby) => !before.has(ruby),
  );
  // 読みが 1 つも足されていない直しは、直しになっていない。
  if (added.length === 0) return false;

  const flat = normalizeLongVowels(kana.replace(/\s+/g, ""));
  return added.every((ruby) => {
    const reading = ruby.slice(1, -1).split("|")[1] ?? "";
    return flat.includes(normalizeLongVowels(reading.replace(/\s+/g, "")));
  });
}

export interface LineToCheck {
  text: string;
  speakerId: number;
}

export interface FixOptions {
  /**
   * 考える深さ。
   *
   * 台本をまとめて直すときは指定しない。回数が少ないので、深く考えさせる。
   * 喋りながら直すときは low を渡す。答えが返るまでの間、次の発言が待たされる。
   */
  effort?: "low" | "medium" | "high";
}

/**
 * 台詞をまとめて確かめ、誤読があればルビを付けて返す。
 *
 * 返る配列は渡した順と同じ長さになる。直すところが無ければ元のまま入る。
 */
export async function fixMisreadingsAll(
  lines: LineToCheck[],
  options: FixOptions = {},
): Promise<string[]> {
  if (lines.length === 0) return [];

  const listed: string[] = [];
  for (const [index, line] of lines.entries()) {
    const kana = await spokenKana(line.text, line.speakerId);
    if (!kana) continue;
    listed.push(`${index + 1}\t台詞: ${line.text}`);
    listed.push(`${index + 1}\t音: ${kana}`);
  }
  if (listed.length === 0) return lines.map((l) => l.text);

  const prompt = [
    "台詞と、それを読み上げたときの音を並べる。",
    "",
    ...listed,
    "",
    ...HOW_TO_FIX,
    "",
    "直した台詞を、次の形で 1 行ずつ返す。",
    "番号<タブ>台詞",
    "",
    "直すところが無い台詞は返さない。説明も前置きも書かない。",
  ].join("\n");

  return runFix(prompt, lines, options);
}

/**
 * 誤読の直し方。台詞が 1 つでも、まとめて何本でも、見方は同じ。
 */
const HOW_TO_FIX: string[] = [
  "はじめに、台詞に出てくる漢字の語を、自分ならどう読むかを思い浮かべる。",
  "その読みと、並んでいる音を突き合わせる。",
  "食い違う語は、字の並びとして正しく読めていても直す。",
  "「食感」は「ショッカン」と読む。音が「ショクカン」なら、詰まる音が抜けている。",
  "字を見て納得できる音でも、その語の読みとして正しいとは限らない。",
  "",
  "音を声に出したとき、台詞と違う言葉に聞こえる箇所も、同じように直す。",
  "",
  "例。「得しない」が「エシナイ」と読まれている。",
  "「得」は「トク」と読む字なので、これは違う言葉になっている。",
  "この場合は {得|トク}しない と書く。",
  "",
  "直す前に、その語が本当に違って読まれているかを声に出して確かめる。",
  "音は台詞の順に並んでいる。伸ばす音は、直前の母音の字で書かれる。",
  "「モオテン」は「盲点」、「セッテエ」は「設定」、「テエコオ」は「抵抗」の正しい音。",
  "どれも違う言葉ではない。読みを付けると、かえって語が割れる。",
  "",
  "次のものは直さない。手を入れると、かえって読みが崩れる。",
  "  正しく読めている語。合っているなら触らない",
  "  すでに {語|カタカナ} が付いている語",
  "  [ ] で囲まれた表情の指定。声には出ない",
  "",
  "かなだけで書かれた語も、音が違えば直す。",
  "助詞の「は」は「ワ」、「へ」は「エ」と読む。",
  "字のまま「ハ」「ヘ」と読まれていれば、違う言葉になっている。",
  "「ボクはね」が「ボク ハネ」と読まれていれば {ボクはね|ボクワネ} と書く。",
  "囲むのは助詞の前の語からにする。助詞だけを囲むと、切れ目が動いて崩れる。",
  "",
  "読みを付けるときは、熟語をまとめて囲む。",
  "「盲点」を直すなら {盲点|モウテン} と書く。{盲|ボウ}点 のように片方だけ囲まない。",
  "",
  "読みはカタカナで書く。ひらがなだと語の切れ目を見失って別の音になる。",
];

/**
 * 問いを投げて、返ってきた直しのうち効いたものだけを採る。
 *
 * 返る配列は渡した順と同じ長さになる。
 */
async function runFix(
  prompt: string,
  lines: LineToCheck[],
  options: FixOptions,
): Promise<string[]> {
  let answer = "";
  try {
    for await (const message of query({
      prompt,
      options: {
        model: MODEL,
        ...(options.effort ? { effort: options.effort } : {}),
        maxTurns: 1,
        tools: [] as string[],
        allowedTools: [] as string[],
        mcpServers: {},
        extraArgs: { "strict-mcp-config": null },
        settingSources: [] as [],
      },
    })) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") answer += block.text;
        }
      }
    }
  } catch {
    return lines.map((l) => l.text);
  }

  const fixed = lines.map((l) => l.text);
  const proposals = new Map<number, string>();
  for (const row of answer.split("\n")) {
    const matched = row.match(/^\s*(\d+)\s*[\t:：]\s*(.+)$/);
    if (!matched) continue;
    const index = Number(matched[1]) - 1;
    if (index < 0 || index >= fixed.length) continue;
    const candidate = matched[2].trim();
    // 別の台詞に書き換えられていないか確かめる。
    // ルビを外した形が元と変われば、直しではなく作り直しになっている。
    if (stripRuby(candidate) !== stripRuby(lines[index].text)) continue;
    proposals.set(index, candidate);
  }

  // 直した形をもう一度読ませて、確かに効いたものだけを採る。
  //
  // 見るのは 2 つ。
  //
  // 音が動いたか。正しく読めている語に読みを付けても音は変わらない。
  // 「盲点」は元から「モオテン」と読めている。直す必要が無かったということ。
  //
  // 比べる前に、伸ばす音の書き方を揃える。
  // 「テエコオ」に「テイコウ」を当てると字は変わるが、声に出せば同じ「テーコー」。
  // 揃えずに見ると、変わっていない音を変わったと数えてしまう。
  //
  // 足した読みが音に出たか。「盲」だけに読みを付けると「ボウテン」になる。
  // 指定と違う音が出るなら、囲む範囲が狭くて切れ目が動いている。直したつもりで壊れる。
  for (const [index, candidate] of proposals) {
    const before = await spokenKana(lines[index].text, lines[index].speakerId);
    const after = await spokenKana(candidate, lines[index].speakerId);
    if (!after) continue;
    if (normalizeLongVowels(before ?? "") === normalizeLongVowels(after)) {
      continue;
    }
    if (!addedReadingsLanded(lines[index].text, candidate, after)) continue;
    fixed[index] = candidate;
  }

  return fixed;
}

/**
 * 1 台詞ぶんの問いを組み立てる。
 *
 * 喋りながら直す経路で使う。台詞を作ったのと同じセッションへ、続けて投げる。
 * 起動を 2 回払わずに済むため、再生の裏に収まる。
 *
 * 読み上げる音が取れなければ null を返す。確かめようがない。
 */
export async function buildFixPrompt(
  text: string,
  speakerId: number,
): Promise<string | null> {
  const kana = await spokenKana(text, speakerId);
  if (!kana) return null;

  return [
    "いま返した台詞を読み上げると、こう聞こえる。",
    kana,
    "",
    ...HOW_TO_FIX,
    "",
    "直した台詞だけを返す。直すところが無ければ、元の台詞をそのまま返す。",
    "感情の指定と、意味の切れ目の / は、元のまま残す。",
    "説明も前置きも書かない。",
  ].join("\n");
}

/**
 * 返ってきた直しが効いているかを確かめる。効いていなければ null。
 *
 * 見るところは台本をまとめて直すときと同じ。
 * 別の台詞に書き換えられていないか、音が動いたか、足した読みが音に出たか。
 */
export async function acceptFix(
  original: string,
  answer: string,
  speakerId: number,
): Promise<string | null> {
  // ルビを外した形が元と一致する行を拾う。
  // 説明が混ざって返ってきても、台詞の行だけを取り出せる。
  const candidate = answer
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.length > 0 && stripRuby(row) === stripRuby(original));
  if (!candidate || candidate === original) return null;

  const before = await spokenKana(original, speakerId);
  const after = await spokenKana(candidate, speakerId);
  if (!after) return null;
  if (normalizeLongVowels(before ?? "") === normalizeLongVowels(after)) {
    return null;
  }
  if (!addedReadingsLanded(original, candidate, after)) return null;

  return candidate;
}
