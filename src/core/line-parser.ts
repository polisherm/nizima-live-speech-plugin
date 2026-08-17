// 台詞を読み解いて、扱いやすい形にする。
//
// 台詞には 3 つの記法が混ざる。
//
//   [smile]        そこから先の表情
//   {語|ヨミ}      画面に出す字と、声に出す音が違う語
//   /              字幕を折り返してよい位置
//   『語――ヨミ――』 ルビ芸。画面には両方出るが、声に出すのは後ろだけ
//
// これらを混ぜたまま切ったり数えたりすると、記法の途中で切れる。
// 読みだけが画面に出たり、区切りの記号が字幕に残る。
//
// そこで、読み解くのはここ 1 か所だけにする。
// 以降は文字列ではなく、意味の付いた部品として扱う。
// 部品の境目でしか切らないので、記法が壊れることが起きない。

/** 声に出す音と、画面に出す字が違う語。 */
export interface RubyPart {
  kind: "ruby";
  display: string;
  reading: string;
}

/** そのまま読んで、そのまま出す文字。 */
export interface TextPart {
  kind: "text";
  text: string;
}

/** 字幕を折り返してよい位置。声には出ない。 */
export interface BreakPart {
  kind: "break";
}

export type Part = TextPart | RubyPart | BreakPart;

/** ひとつの表情で話す範囲。 */
export interface Segment {
  emotion: string;
  parts: Part[];
}

/**
 * ルビ芸の表記。『日常語――大げさな別名――』の形で書かれる。
 *
 * 画面には表記のまま出し、声に出すのは別名だけにする。
 * 両方読むと決め台詞の切れ味が落ちる。
 *
 * 区切りの横棒は見た目のよく似た字が複数ある。書く側で揺れるため、まとめて受ける。
 */
// 長音の「ー」は入れない。見た目は似ているが、カタカナ語の末尾に来る字で、
// 区切りとして扱うと「ナイトウォーカー」の末尾が区切りに食われる。
const RUBY_ART = /『([^『』]+?)[—―−–]{2,}([^『』]+?)[—―−–]{2,}』/;

/** 読みの指定。{語|ヨミ} の形。 */
const RUBY = /\{([^{}|]+)\|([^{}|]+)\}/;

/**
 * 入れ子になった読みの指定を平す。
 *
 * 生成では {天{麩羅|ぷら}|テンプラ} のように、二重に書かれることがある。
 * 難しい字にまず読みを振り、そのうえで語全体にも振ってしまう形。
 *
 * 読みの指定は入れ子を想定していない。内側だけがルビとして拾われ、
 * 外側の { と | は文字として残る。字幕には波括弧がそのまま出て、
 * 声は「天ぷら」と「テンプラ」を続けて読む。
 *
 * 採るのは外側にする。語全体に振られた読みのほうが、意図に近い。
 * 内側は表示の字だけ残す。
 */
const NESTED_RUBY = /\{([^{}|]*)\{([^{}|]+)\|[^{}|]+\}([^{}|]*)\|([^{}|]+)\}/;

function flattenNestedRuby(raw: string): string {
  let text = raw;
  // 三重に書かれることもある。変わらなくなるまで繰り返す。
  // 上限を置くのは、書き換えが止まらない形が来ても抜けられるようにするため。
  for (let round = 0; round < 5; round++) {
    const next = text.replace(NESTED_RUBY, "{$1$2$3|$4}");
    if (next === text) break;
    text = next;
  }
  return text;
}

/** 表情の指定。[smile] の形。全角の括弧でも受ける。 */
const EMOTION_TAG = /[[［]\s*([a-zA-Z]+)\s*[\]］]/;

/** 表情の名前として通すもの。知らない名前はただの文字として扱う。 */
export type EmotionCheck = (name: string) => boolean;

/**
 * 台詞を、表情の区間と部品の列に読み解く。
 *
 * 表情の指定が無いまま始まる台詞は、fallback の表情で始める。
 */
export function parseLine(
  raw: string,
  isEmotion: EmotionCheck,
  fallback = "neutral",
): Segment[] {
  const segments: Segment[] = [];
  let emotion = fallback;
  let parts: Part[] = [];

  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
  };

  const closeSegment = () => {
    // 中身のない区間は作らない。表情の指定が続けて置かれることがある。
    if (parts.some((p) => p.kind !== "break")) {
      segments.push({ emotion, parts });
    }
    parts = [];
  };

  // 入れ子は読み解けない。読み解く前に平しておく。
  let rest = flattenNestedRuby(raw);
  while (rest.length > 0) {
    // いちばん手前にある記法を探す。
    const candidates: Array<{ at: number; length: number; apply: () => void }> =
      [];

    const tag = rest.match(EMOTION_TAG);
    if (tag?.index !== undefined && isEmotion(tag[1].toLowerCase())) {
      candidates.push({
        at: tag.index,
        length: tag[0].length,
        apply: () => {
          closeSegment();
          emotion = tag[1].toLowerCase();
        },
      });
    }

    const art = rest.match(RUBY_ART);
    if (art?.index !== undefined) {
      candidates.push({
        at: art.index,
        length: art[0].length,
        // 画面には表記のまま、声には別名だけ。
        apply: () =>
          parts.push({ kind: "ruby", display: art[0], reading: art[2] }),
      });
    }

    const ruby = rest.match(RUBY);
    if (ruby?.index !== undefined) {
      // 波括弧が二重に書かれることがある。外側は余りなので、あれば一緒に食う。
      const doubled =
        rest[ruby.index - 1] === "{" &&
        rest[ruby.index + ruby[0].length] === "}";
      candidates.push({
        at: doubled ? ruby.index - 1 : ruby.index,
        length: doubled ? ruby[0].length + 2 : ruby[0].length,
        apply: () =>
          parts.push({
            kind: "ruby",
            display: ruby[1],
            // 読みに切れ目や空白が紛れることがある。声には出さない印なので落とす。
            reading: ruby[2].replace(/[/\s]/g, ""),
          }),
      });
    }

    const breakAt = rest.indexOf("/");
    if (breakAt !== -1) {
      candidates.push({
        at: breakAt,
        length: 1,
        apply: () => parts.push({ kind: "break" }),
      });
    }

    if (candidates.length === 0) {
      pushText(rest);
      break;
    }

    // 手前にあるものから順に処理する。同じ位置なら長いほうを優先する。
    // 二重に書かれた波括弧では、外側の { が先に見つかっても中身は内側にある。
    candidates.sort((a, b) => a.at - b.at || b.length - a.length);
    const next = candidates[0];

    pushText(rest.slice(0, next.at));
    next.apply();
    rest = rest.slice(next.at + next.length);
  }

  closeSegment();

  // 表情の指定しかない台詞でも、空で返さない。
  if (segments.length === 0) return [{ emotion, parts: [] }];
  return segments;
}

/** 画面に出す形にする。折り返しの印は落とす。 */
export function toDisplay(parts: Part[]): string {
  return parts
    .map((p) =>
      p.kind === "text" ? p.text : p.kind === "ruby" ? p.display : "",
    )
    .join("");
}

/**
 * 字幕に渡す形にする。折り返しの印は残す。
 *
 * どこで行を折るかは描画側が決める。印はその手がかりになる。
 */
export function toSubtitle(parts: Part[]): string {
  return parts
    .map((p) =>
      p.kind === "text" ? p.text : p.kind === "ruby" ? p.display : "/",
    )
    .join("");
}

/**
 * 声に出す形にしつつ、折り返しの印を区切りに変える。
 *
 * 印を落としてつなげると、語の境目を取り違えることがある。
 * 「ボクは」と「ずんだ餅」をつなげると「はずんだ」がひとまとまりに解かれ、
 * 助詞の「は」が「わ」で読まれなくなる。
 *
 * ただし区切りを置くと、そこに短い無音が入る。
 * どちらを使うかは、読みが変わるかどうかで決める（voicevox.ts を参照）。
 */
export function toReadingWithPause(parts: Part[]): string {
  return parts
    .map((p) =>
      p.kind === "text" ? p.text : p.kind === "ruby" ? p.reading : "、",
    )
    .join("")
    .replace(/[、，]{2,}/g, "、")
    .replace(/([。！？…‥、，])\s*、/g, "$1")
    .replace(/^\s*、/, "");
}

/** 声に出す形にする。 */
export function toReading(parts: Part[]): string {
  return parts
    .map((p) =>
      p.kind === "text" ? p.text : p.kind === "ruby" ? p.reading : "",
    )
    .join("");
}

/** 画面に出したときの文字数。折り返しの判断に使う。 */
export function displayLength(parts: Part[]): number {
  return toDisplay(parts).replace(/\s+/g, "").length;
}

/**
 * 部品の列を、区切りの位置で割る。
 *
 * 割ってよいのは部品の境目だけにする。読みの指定を途中で割ることが起きない。
 * text の中は、渡された形で割る。
 */
function splitAt(parts: Part[], pattern: RegExp): Part[][] {
  const groups: Part[][] = [];
  let current: Part[] = [];

  for (const part of parts) {
    if (part.kind !== "text") {
      current.push(part);
      continue;
    }
    const pieces = part.text.split(pattern);
    for (const [index, piece] of pieces.entries()) {
      if (piece) current.push({ kind: "text", text: piece });
      // 最後の断片の後ろには区切りが無い。そこでは割らない。
      if (index < pieces.length - 1 && current.length > 0) {
        groups.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** 折り返しの印の位置で割る。 */
function splitAtBreaks(parts: Part[]): Part[][] {
  const groups: Part[][] = [];
  let current: Part[] = [];
  for (const part of parts) {
    if (part.kind === "break" && current.length > 0) {
      current.push(part);
      groups.push(current);
      current = [];
      continue;
    }
    current.push(part);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** 部品を 1 つずつに割る。text は 1 文字ずつ。 */
function splitToAtoms(parts: Part[]): Part[] {
  const atoms: Part[] = [];
  for (const part of parts) {
    if (part.kind !== "text") {
      atoms.push(part);
      continue;
    }
    for (const char of part.text) atoms.push({ kind: "text", text: char });
  }
  return atoms;
}

/**
 * 収まるまで詰めて、超えるところで切る。
 *
 * 渡された単位より細かくは割らない。
 * 見るのは字の数だけにする。行をどこで折るかは描く側が決める。
 */
function pack(units: Part[][], maxChars: number): Part[][] {
  const groups: Part[][] = [];
  let current: Part[] = [];
  for (const unit of units) {
    if (
      current.length > 0 &&
      displayLength(current) + displayLength(unit) > maxChars
    ) {
      groups.push(current);
      current = [];
    }
    current.push(...unit);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * 部品の列を、字幕に収まる長さへ切り分ける。
 *
 * 切る位置は部品の境目に限る。読みの指定を途中で割ることが起きない。
 *
 * 割り方は 4 段ある。上から順に試し、収まったらそこで止める。
 *
 *   1. 文の終わりで割る
 *   2. 読点で割る
 *   3. 折り返しの印で割る
 *   4. 字の数で割る
 *
 * 上の段ほど意味の切れ目に沿う。下の段は、上で収まらなかったときだけ使う。
 */
export function splitParts(parts: Part[], maxChars: number): Part[][] {
  const result: Part[][] = [];

  // 字幕に収まるかどうか。字の数だけで見る。
  const fits = (group: Part[]) => displayLength(group) <= maxChars;

  // 1 段目。文で割り、収まるところまで詰める。
  const sentences = splitAt(parts, /(?<=[。！？!?])|(?<=…{2,})|(?<=‥+)/);

  for (const sentence of pack(sentences, maxChars)) {
    if (fits(sentence)) {
      result.push(sentence);
      continue;
    }
    // 2 段目。読点で割る。
    for (const clause of pack(splitAt(sentence, /(?<=[、，])/), maxChars)) {
      if (fits(clause)) {
        result.push(clause);
        continue;
      }
      // 3 段目。折り返しの印で割る。
      for (const piece of pack(splitAtBreaks(clause), maxChars)) {
        if (fits(piece)) {
          result.push(piece);
          continue;
        }
        // 4 段目。字の数で割る。読みの指定はここでも 1 つのまま。
        result.push(
          ...pack(
            splitToAtoms(clause).map((atom) => [atom]),
            maxChars,
          ),
        );
      }
    }
  }

  // 画面に何も出ない塊は、前へ回す。
  //
  // 印だけの塊のほか、空白だけが残ることもある。
  // 表情の指定の前後に置かれた空白が、そのまま塊になる。
  // どちらも画面には話者名しか出ず、台詞が消えたように見える。
  const settled: Part[][] = [];
  for (const group of result) {
    if (displayLength(group) > 0) {
      settled.push(group);
      continue;
    }
    if (settled.length > 0) settled[settled.length - 1].push(...group);
  }

  // 塊の端に来た印を落とす。折り返す先が無く、字幕に記号だけが残る。
  for (const group of settled) {
    while (group.length > 0 && group[group.length - 1].kind === "break") {
      group.pop();
    }
    while (group.length > 0 && group[0].kind === "break") group.shift();
  }

  return settled.length > 0 ? settled : [parts];
}
