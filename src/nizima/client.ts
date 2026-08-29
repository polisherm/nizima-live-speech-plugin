import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { config, REPO_ROOT } from "../config.js";
import type {
  EstablishConnectionResponse,
  RegisterPluginResponse,
} from "./types.js";

// nizima LIVE のプラグインマネージャーに出る 3 つ。登録のときだけ渡す。
// API で必須なのは Name だけで、Developer と Version は任意。
// fork して別物として登録するなら、名前と開発者を書き換える。
const PLUGIN_NAME = "nizima-live-speech-plugin";
const PLUGIN_DEVELOPER = "polisherm";

// 版の正本は package.json に置く。ここに直接書くと 2 か所を手で揃えることになる。
// ズレても動くため、nizima LIVE の画面に出る版だけが古いまま残る。
const PLUGIN_VERSION = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
).version as string;

// nizima LIVE Plugin API の版。全メッセージのヘッダー（nLPlugin）に入る。
// プラグインの版ではなく、通信の仕様の版。API 側が上がったときだけ追随する。
const PROTOCOL_VERSION = "1.0.0";

// 認証トークンの置き場。プロジェクトの直下に置く。
//
// 場所がずれると、保存してあるトークンを読めない。
// そのたびに認証をやり直すため、nizima 側に同じ名前のプラグインが増える。
const STATE_FILE = path.join(REPO_ROOT, "state.json");

interface PluginMessage {
  nLPlugin: string;
  Timestamp?: number;
  Id?: string;
  Type: "Request" | "Response" | "Event" | "Error";
  Method: string;
  Data?: unknown;
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

function loadToken(): string | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    return typeof state.token === "string" ? state.token : null;
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  writeFileSync(STATE_FILE, JSON.stringify({ token }, null, 2), "utf-8");
}

/**
 * プラグインが無効なときの案内。
 *
 * 繋がっても、有効にするまでは何も通らない。
 * 有効にするのは nizima の画面を触る人で、こちらからは頼めない。
 *
 * ErrorType をそのまま出すと、読んだ人は次の一手を決められない。
 * どこを触ればいいかまで書く。
 */
function disabledMessage(justRegistered = false): string {
  const head = justRegistered
    ? `nizima LIVE に ${PLUGIN_NAME} を登録した。`
    : `${PLUGIN_NAME} が nizima LIVE 側で無効になっている。`;
  return `${head}\nプラグインマネージャーでトグルを有効にしてから、もう一度実行する。`;
}

/** Error の Data が PluginDisabled かどうか。 */
function isPluginDisabled(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  if (!("ErrorType" in data)) return false;
  return data.ErrorType === "PluginDisabled";
}

/**
 * nizima LIVE Plugin API の WebSocket クライアント。
 * 接続と認証（RegisterPlugin / EstablishConnection）を担う。
 * トークンは state.json に保存し、次回から再利用する。
 */
export class NizimaClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private counter = 0;
  private readonly eventHandlers = new Map<string, (data: unknown) => void>();

  constructor(private readonly url = "ws://localhost:22022/") {}

  async connect(): Promise<void> {
    await this.open();

    const token = loadToken();
    if (token) {
      // 鍵が通ったかどうかと、使える状態かどうかを分けて見る。
      // 無効だったときに登録へ落とすと、nizima LIVE 側に同じ名前の登録が増える。
      let established: EstablishConnectionResponse | null = null;
      try {
        established = await this.request<EstablishConnectionResponse>(
          "EstablishConnection",
          {
            Name: PLUGIN_NAME,
            Token: token,
            Version: PLUGIN_VERSION,
          },
        );
      } catch {
        // トークンが無効になっている。登録からやり直す。
      }
      if (established) {
        if (!established.Enabled) throw new Error(disabledMessage());
        return;
      }
    }

    const response = await this.request<RegisterPluginResponse>(
      "RegisterPlugin",
      {
        Name: PLUGIN_NAME,
        Developer: PLUGIN_DEVELOPER,
        Version: PLUGIN_VERSION,
      },
    );
    saveToken(response.Token);
    // 登録しただけでは何も通らない。
    // このまま先へ進めても最初の Method で落ちるので、ここで案内して止める。
    throw new Error(disabledMessage(true));
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () =>
        reject(
          new Error(
            `WebSocket 接続に失敗: ${this.url} — nizima LIVE の起動とプラグイン機能の有効化を確認`,
          ),
        ),
      );
      socket.addEventListener("message", (event) => {
        this.onMessage(String(event.data));
      });
    });
  }

  private onMessage(raw: string): void {
    let message: PluginMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.Type === "Event") {
      this.eventHandlers.get(message.Method)?.(message.Data);
      return;
    }

    if (!message.Id) return;
    const pending = this.pending.get(message.Id);
    if (!pending) return;
    this.pending.delete(message.Id);

    if (message.Type === "Error") {
      // 動かしている途中で無効にされることもある。
      // どの Method でも同じ形で返るので、ここで一度だけ言い換える。
      pending.reject(
        isPluginDisabled(message.Data)
          ? new Error(disabledMessage())
          : new Error(
              `${message.Method} error: ${JSON.stringify(message.Data)}`,
            ),
      );
    } else {
      pending.resolve(message.Data);
    }
  }

  onEvent(method: string, handler: (data: unknown) => void): void {
    this.eventHandlers.set(method, handler);
  }

  /**
   * 1 つ問い合わせる。返る形は呼ぶ側が型引数で決める。
   *
   * 届いた JSON をその型として扱うだけで、中身は確かめない。
   * 型は nizima-types.ts にまとめてある。
   */
  request<T = unknown>(
    method: string,
    data: unknown = {},
    timeoutMs = 15000,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }

    const id = `req-${++this.counter}`;
    const message: PluginMessage = {
      nLPlugin: PROTOCOL_VERSION,
      Timestamp: Date.now(),
      Id: id,
      Type: "Request",
      Method: method,
      Data: data,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      socket.send(JSON.stringify(message));
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
