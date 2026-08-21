import { writeFileSync } from "node:fs";

import { config } from "./config.js";

// 待ち受け先と、間の取り方は config.ts が持つ。
//
// 「ああ、」のあとは 0.48 秒、「うーん、」のあとは 0.63 秒。
// ふつうの語のあとは 0.25 秒から 0.34 秒に収まる。上限はこの実測から決めた。
const VOICEVOX_URL = config.voicevoxUrl;
const PAUSE_LENGTH_SCALE = config.voicevoxPauseScale;
const MAX_PAUSE_SEC = config.voicevoxMaxPauseSec;

/**
 * 読み上げの単位の末尾に足す無音（秒）。
 *
 * 単位は文の切れ目で作る。ところが既定の末尾の無音は 0.1 秒しかなく、
 * 文の中の句点（約 0.4 秒）より短い。
 * 文の切れ目のほうが間が詰まって、次の文へ続けて読んだように聞こえる。
 *
 * 文の終わりで切ったなら句点に、途中で切ったなら読点より短めに合わせる。
 */
const TAIL_SILENCE_SENTENCE_SEC = 0.4;
const TAIL_SILENCE_CLAUSE_SEC = 0.05;

/**
 * 読み上げの単位の先頭に置く無音（秒）。
 *
 * 単位ごとに別の音声を作るため、既定のままだと前後の余白が足し算になる。
 * 文の途中で割った場所にも間が生まれ、一区切りごとに息をついて聞こえる。
 */
const HEAD_SILENCE_SEC = 0.05;

/**
 * VOICEVOX Engine の HTTP API で音声を合成する。
 * audio_query で調整パラメータを作り、synthesis で wav を得る 2 段構成。
 */
async function audioQuery(text: string, speakerId: number): Promise<any> {
  const response = await fetch(
    `${VOICEVOX_URL}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(
      `audio_query failed: ${response.status} — VOICEVOX の起動を確認`,
    );
  }
  return response.json();
}

/**
 * 読みだけを取り出して比べられる形にする。
 *
 * kana にはアクセントと区切りの記号が混ざる。
 * 区切りを入れたかどうかで記号は変わるため、読みの違いだけを見るには落とす。
 */
function bareReading(kana: string): string {
  return kana.replace(/[^ァ-ヶー]/g, "");
}

/**
 * 声の出し方。既定からの差分で持つ。
 *
 * 話者のスタイルは声質の違いで、感情のために用意されたものではない。
 * 合わないものを当てると、別人が喋っているように聞こえる。
 *
 * 同じ声のまま、速さと高さと抑揚を動かすほうが、気持ちの幅は作りやすい。
 * 怒りは速く強く、落ち込みは遅く平坦に、といった当て方ができる。
 */
export interface VoiceTuning {
  /** 話す速さ。1 が既定。大きいほど速い。 */
  speed?: number;
  /** 声の高さ。0 が既定。動かせる幅は狭く、0.1 を超えると声が壊れる。 */
  pitch?: number;
  /** 抑揚の強さ。1 が既定。0 で平坦になる。 */
  intonation?: number;
}

export async function synthesize(
  text: string,
  speakerId: number,
  outPath: string,
  options: { withBreaks?: string; tuning?: VoiceTuning } = {},
): Promise<{
  durationSec: number;
  speakingSec: number;
  silences: Silence[];
}> {
  let query = await audioQuery(text, speakerId);

  // 区切りを入れた形とも読み比べる。
  //
  // 意味の切れ目を落としてつなげると、語の境目を取り違えることがある。
  // 「ボクは」＋「ずんだ餅」は、つなげると「はずんだ」がひとまとまりになり、
  // 助詞の「は」が「わ」で読まれなくなる。
  //
  // かといって切れ目をすべて区切りにすると、一息で言う場所にも無音が入る。
  // 「〜って」と「言うけど」の間で息が切れて、喋りが不自然になる。
  //
  // 読みが変わる切れ目だけが、語の境目を守っている。
  // 両方を解析させ、読みが変わったときだけ区切りを入れた形を使う。
  if (options.withBreaks && options.withBreaks !== text) {
    const alternative = await audioQuery(options.withBreaks, speakerId).catch(
      () => null,
    );
    if (alternative && bareReading(alternative.kana) !== bareReading(query.kana)) {
      query = alternative;
    }
  }

  // 声の出し方を当てる。読みを決めたあとに置く。
  // 先に置くと、読み比べで差し替わる形に上書きされて消える。
  if (options.tuning) {
    const { speed, pitch, intonation } = options.tuning;
    if (speed !== undefined) query.speedScale = speed;
    if (pitch !== undefined) query.pitchScale = pitch;
    if (intonation !== undefined) query.intonationScale = intonation;
  }

  // 長すぎる無音を抑える。口パクの計算もここを見るので、先に切っておく。
  for (const phrase of query.accent_phrases ?? []) {
    const pause = phrase.pause_mora;
    if (pause && pause.vowel_length > MAX_PAUSE_SEC) {
      pause.vowel_length = MAX_PAUSE_SEC;
    }
  }

  query.pauseLengthScale = PAUSE_LENGTH_SCALE;
  // 末尾の無音を、文の中の句読点と同じくらいにする。
  // 文の途中で割った場所は、次へ続くので短くする。
  query.postPhonemeLength = /[。！？…‥]\s*$/.test(text)
    ? TAIL_SILENCE_SENTENCE_SEC
    : TAIL_SILENCE_CLAUSE_SEC;
  query.prePhonemeLength = HEAD_SILENCE_SEC;

  const synthResponse = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${speakerId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    },
  );
  if (!synthResponse.ok) {
    throw new Error(`synthesis failed: ${synthResponse.status}`);
  }

  const wav = Buffer.from(await synthResponse.arrayBuffer());
  writeFileSync(outPath, wav);

  // 無音の区間も返す。口パクは声が出ている間だけ動かす。
  // 句読点の間や末尾の余韻まで動かすと、黙っているのに口だけ開閉して見える。
  // 末尾の余韻も話す速さで縮む。割らずに引くと、口を閉じる位置がずれる。
  const durationSec = wavDurationSec(wav);
  const tail = query.postPhonemeLength / (query.speedScale || 1);
  return {
    durationSec,
    speakingSec: Math.max(0, durationSec - tail),
    silences: collectSilences(query),
  };
}

/** 声が出ていない区間（秒）。開始と終了で表す。 */
export interface Silence {
  start: number;
  end: number;
}

/**
 * 声が出ていない区間を求める。
 *
 * audio_query は音の並びを、拍（モーラ）と句読点の無音に分けて返す。
 * 先頭から順に長さを足していけば、無音がいつ始まっていつ終わるかが分かる。
 *
 * 求めるのは、先頭の余白・句読点の間・末尾の余韻の 3 つ。
 * 話す速さの倍率は全体にかかるので、最後に割る。
 */
function collectSilences(query: any): Silence[] {
  const speed = query.speedScale || 1;
  const silences: Silence[] = [];

  let at = query.prePhonemeLength;
  if (at > 0) silences.push({ start: 0, end: at });

  for (const phrase of query.accent_phrases ?? []) {
    for (const mora of phrase.moras ?? []) {
      at += (mora.consonant_length ?? 0) + (mora.vowel_length ?? 0);
    }
    if (phrase.pause_mora) {
      const length =
        (phrase.pause_mora.vowel_length ?? 0) * (query.pauseLengthScale || 1);
      silences.push({ start: at, end: at + length });
      at += length;
    }
  }

  silences.push({ start: at, end: at + query.postPhonemeLength });

  return silences.map((s) => ({ start: s.start / speed, end: s.end / speed }));
}

/** wav ヘッダから再生時間を計算する。口パクの継続時間に使う。 */
function wavDurationSec(wav: Buffer): number {
  // RIFF ヘッダ: byteRate は offset 28、データ長は offset 40。
  const byteRate = wav.readUInt32LE(28);
  const dataSize = wav.readUInt32LE(40);
  return byteRate > 0 ? dataSize / byteRate : 0;
}

/**
 * 読み上げたときの音を返す。合成はしない。
 *
 * 誤読を見つけるのに使う。実際に鳴らす前に、どう読むかだけを確かめられる。
 */
export async function audioQueryKana(
  text: string,
  speakerId: number,
): Promise<string> {
  const query = await audioQuery(text, speakerId);
  return query.kana ?? "";
}

/**
 * 話者を先に読み込ませる。
 *
 * 最初の合成では、その話者のモデルを読み込む時間が乗る。
 * 喋り出す前に済ませておけば、1 つ目の台詞で待たされない。
 */
export async function initializeSpeaker(speakerId: number): Promise<void> {
  await fetch(`${VOICEVOX_URL}/initialize_speaker?speaker=${speakerId}`, {
    method: "POST",
  }).catch(() => {});
}

/** 話者一覧を取得する。声選びに使う。 */
export async function listSpeakers(): Promise<
  Array<{ name: string; styles: Array<{ id: number; name: string }> }>
> {
  const response = await fetch(`${VOICEVOX_URL}/speakers`);
  if (!response.ok) {
    throw new Error(`speakers failed: ${response.status} — VOICEVOX の起動を確認`);
  }
  return response.json();
}
