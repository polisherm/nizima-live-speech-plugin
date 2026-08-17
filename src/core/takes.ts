import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 台本の置き場。
 *
 * 喋らせた回をここに残す。同じお題でも毎回ちがう内容になるため、
 * 気に入った回は残しておかないと二度と出てこない。
 */
export const TAKES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "takes",
);
