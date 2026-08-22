// nizima LIVE Plugin API が返す形。
//
// 同じ形を各所で書き写していた。GetModels の受け取り方だけで 7 か所あった。
// 書き写しは、返る形が変わったときに直し漏れる。ここにまとめる。
//
// 実行時に確かめてはいない。届いた JSON をこの形として扱うだけ。
// 仕様は https://github.com/Live2D/nizimaLIVEPluginAPI の methods.md にある。

/** シーンに出ているモデル。 */
export interface ModelInfo {
  ModelId: string;
  Name?: string;
  ModelPath?: string;
  PositionX?: number;
  PositionY?: number;
  Scale?: number;
  Rotation?: number;
}

/** 登録済みのモデル。まだシーンには出ていない。 */
export interface RegisteredModelInfo {
  Name?: string;
  ModelPath?: string;
}

export interface ExpressionInfo {
  Name: string;
  ExpressionPath: string;
  Active?: boolean;
}

export interface MotionInfo {
  Name?: string;
  MotionPath?: string;
}

/** パラメータの定義。既定値と動かせる幅を持つ。 */
export interface CubismParameterDef {
  Id: string;
  Name?: string;
  DefaultValue: number;
  Min: number;
  Max: number;
}

/** パラメータのいまの値。 */
export interface ParameterValue {
  Id: string;
  Value: number;
}

export interface LiveParameterDef {
  Id: string;
  Group?: string;
  Name?: string;
  Min?: number;
  Max?: number;
  Base?: number;
}

/** 画面に置いた画像など。 */
export interface ItemInfo {
  ItemId: string;
  ItemPath?: string;
}

export interface SceneInfo {
  SceneId?: string;
  Name?: string;
}

export interface GetModelsResponse {
  Models: ModelInfo[];
}

export interface GetRegisteredModelsResponse {
  RegisteredModels: RegisteredModelInfo[];
}

export interface GetExpressionsResponse {
  Expressions: ExpressionInfo[];
}

export interface GetMotionsResponse {
  Motions: MotionInfo[];
}

export interface GetCubismParametersResponse {
  CubismParameters?: CubismParameterDef[];
}

export interface GetCubismParameterValuesResponse {
  CubismParameterValues?: ParameterValue[];
}

export interface GetLiveParameterValuesResponse {
  LiveParameterValues: ParameterValue[];
}

export interface GetLiveParametersResponse {
  LiveParameters: LiveParameterDef[];
}

export interface GetCurrentModelIdResponse {
  ModelId: string;
}

export interface GetCurrentSceneIdResponse {
  SceneId: string;
}

export interface GetScenesResponse {
  Scenes: SceneInfo[];
}

export interface GetItemsResponse {
  Items?: ItemInfo[];
}

export interface AddItemResponse {
  ItemId: string;
}

export interface AddModelResponse {
  ModelId: string;
}

/** プラグインを登録したときに返る鍵。次からはこれで繋ぐ。 */
export interface RegisterPluginResponse {
  Token: string;
}

/**
 * 保存した鍵で繋ぎ直したときの応答。
 *
 * Enabled が false のあいだ、どの Method も PluginDisabled で失敗する。
 * 繋がったことと使えることは別で、有効にするのは nizima の画面を触る人。
 */
export interface EstablishConnectionResponse {
  Enabled: boolean;
}
