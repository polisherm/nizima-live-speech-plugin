import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { config, REPO_ROOT } from "../config.js";
import type { RegisterPluginResponse } from "./types.js";

const PLUGIN_NAME = "nizima-agent-bridge";
const PLUGIN_VERSION = "0.1.0";
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
      try {
        await this.request("EstablishConnection", {
          Name: PLUGIN_NAME,
          Token: token,
          Version: PLUGIN_VERSION,
        });
        return;
      } catch {
        // トークンが無効になっている。登録からやり直す。
      }
    }

    const response = await this.request<RegisterPluginResponse>(
      "RegisterPlugin",
      {
        Name: PLUGIN_NAME,
        Developer: config.pluginDeveloper,
        Version: PLUGIN_VERSION,
      },
    );
    saveToken(response.Token);
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
      pending.reject(
        new Error(`${message.Method} error: ${JSON.stringify(message.Data)}`),
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
