import path from "node:path";

import { REPO_ROOT } from "./config.js";

/**
 * 台本の置き場。
 *
 * 喋らせた回をここに残す。同じお題でも毎回ちがう内容になるため、
 * 気に入った回は残しておかないと二度と出てこない。
 */
export const TAKES_DIR = path.join(REPO_ROOT, "takes");
