// モデルごとの定義。
//
// 1 体のモデルに、見た目と声をまとめて持たせる。
// キャラクターとモデルは 1 対 1 で結びつく。
//
// ここが持つのは「誰が居るか」だけ。
// 感情から何を出すかを決めるのは emotion.ts。

import path from "node:path";

import { config } from "./config.js";
import type { VoiceTuning } from "./voicevox.js";

/** 感情から引く、見た目と声。 */
export interface EmotionLook {
  expression?: string;
  motion?: string;
  /** VOICEVOX の話者 ID。書かなければ、そのモデルの既定の声で喋る。 */
  speakerId?: number;
  /** 声の出し方。書かなければ既定のまま喋る。 */
  tuning?: VoiceTuning;
}

export interface ModelDefinition {
  /** nizima 側のモデル名。口パク用に作った複製のフォルダ名を指す。 */
  modelName: string;
  /**
   * VOICEVOX の音源の名前。
   *
   * 画面に置くクレジットに使う（credit.ts）。
   * ここのキーは呼びやすい短い名前にしてあるため、正式な名前を別に持つ。
   */
  voiceName: string;
  /** 普段の声。VOICEVOX の話者 ID。 */
  speakerId: number;
  /** ペルソナ定義。会話させるときに system prompt として読む。 */
  personaPath: string;
  /** 字幕の文字色。誰が喋っているかを色でも分かるようにする。 */
  subtitleColor: string;
  /**
   * 共通の割り当てから変えるところ。書いた項目だけが上書きされる。
   *
   * 表情とモーションの名前はモデル間でほぼ共通だが、中身は同じとは限らない。
   * 声も、話者ごとに持っているスタイルが違う。
   *
   * 見た目は実際に再生して確かめること。名前からの推測は当てにならない。
   * 声は聞き比べて決める（probe/try-styles.ts）。
   */
  looks?: Record<string, EmotionLook>;
}

export const MODELS: Record<string, ModelDefinition> = {
  めたん: {
    modelName: "shikoku_metan_talk",
    voiceName: "四国めたん",
    speakerId: 2, // 四国めたん ノーマル
    personaPath: path.join(config.personaDir, "四国めたん.md"),
    subtitleColor: "#FF8FC7", // 髪色に寄せたピンク。背景が明るいので薄くしすぎない
    looks: {
      // 声を変えるのは、聞いて分かるものだけにする。
      // VOICEVOX のスタイルは声質の違いで、感情のために用意されたものではない。
      // 合わないものに当てると、かえって不自然になる。
      angry: { speakerId: 6 }, // ツンツン。冷たくなる
      shy: { speakerId: 0 }, // あまあま
    },
  },
  ずんだもん: {
    modelName: "zundamon_talk",
    voiceName: "ずんだもん",
    speakerId: 3, // ずんだもん ノーマル
    personaPath: path.join(config.personaDir, "ずんだもん.md"),
    subtitleColor: "#7BE85F", // 髪色に寄せた緑。背景が明るいので薄くしすぎない
    looks: {
      // angry のあいだ、口パクが画面に出ない。
      //
      // 値は届いている。送ったとおりに ParamMouthOpenY が 0.15 から 0.80 まで
      // 動くことを実測で確かめた（probe/watch-mouth.ts）。
      // 表情もモーションも口のパラメータを持っておらず、奪ってはいない。
      //
      // exp_angry が ParamcheekPuff を最大にしている。
      // 頬の膨らみと口の開きが、モデルの作りとして競合している。
      // 口パクを Overwrite で通せば開くが、そのときは頬の膨らみが消える。
      //
      // 怒りは掛け合いの一言に出る程度で、口が止まっても目立たない。
      // 頬の膨らみを残す側を採る。
      angry: { speakerId: 7 }, // ツンツン
      // exp_shy はハート目。照れというより好意の表現なので差し替える。
      shy: { expression: "exp_shy2", speakerId: 1 },
      // なみだめ（76）は大泣きの声。ここでの sad は軽くぼやく程度なので使わない。
    },
  },
};

export const MODEL_NAMES = Object.keys(MODELS);

/** nizima 側のモデル名から定義を引く。 */
export function findByModelName(
  modelName: string,
): ModelDefinition | undefined {
  return Object.values(MODELS).find((m) => m.modelName === modelName);
}
