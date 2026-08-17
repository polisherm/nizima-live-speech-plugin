// 役の定義は models.ts へ移した。
//
// 1 体のモデルに、見た目と声をまとめて持たせる形にしたため。
// キャラクターとモデルは 1 対 1 で結びつく。
//
// ここは、これまでの名前で参照している箇所のために残す。
export {
  MODELS as ROLES,
  MODEL_NAMES as ROLE_NAMES,
  type ModelDefinition as Role,
} from "./models.js";
