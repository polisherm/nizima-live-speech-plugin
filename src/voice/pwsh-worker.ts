import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

/**
 * 起動したままにしておく PowerShell のプロセス。
 *
 * 音を鳴らすのも字幕の画像を作るのも、Windows では PowerShell に頼る。
 * Node には音声を鳴らす手段も画像を描く手段も無く、標準で使えるのがこれになる。
 *
 * 呼ぶたびに起動し直すと、1 回あたり 400〜500ms を毎回払う。
 * 台詞の区切りごとに音声と字幕の両方で起動すれば、区切り 1 つで 1 秒近くが待ちになる。
 * プロセスを 1 つ保ち、やることだけを 1 行ずつ送る形にする。
 *
 * やり取りは行単位にする。送るのも受け取るのも 1 行で、行の中身は上位が決める。
 */

/** 応答を待つ上限（ミリ秒）。届かないまま止まると、そこで先へ進めなくなる。 */
const RESPONSE_TIMEOUT_MS = 15000;

/**
 * 使う PowerShell を決める。
 *
 * pwsh（7 系）は自分で入れるもので、Windows に最初から入っているのは powershell（5.1）。
 * ここで使う Media.SoundPlayer と System.Drawing はどちらでも動く。
 * 5.1 で描いた字幕は、7 系で描いたものとバイト単位で同じだった。
 *
 * 探すのは最初の 1 回だけ。結果は使い回す。
 */
let shellPath: string | null = null;

function resolveShell(): string {
  if (shellPath) return shellPath;

  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
      stdio: "ignore",
    });
    if (!probe.error && probe.status === 0) {
      shellPath = candidate;
      return shellPath;
    }
  }

  throw new Error(
    "PowerShell が見つからない。音の再生と字幕の描画に使うため、pwsh か powershell のどちらかが要る",
  );
}

export class PwshWorker {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private waiters: Array<(line: string) => void> = [];

  /** script は起動時に -Command へ渡す。標準入力を読み続ける作りにしておく。 */
  constructor(private readonly script: string) {}

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process) return this.process;

    // 5.1 の既定ポリシーは Restricted で、署名の無い .ps1 を拒む。
    // 字幕はスクリプトファイルを呼び出すため、外さないと描けない。
    const child = spawn(resolveShell(), [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      this.script,
    ]);
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf("\n");
      while (index !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line) this.waiters.shift()?.(line);
        index = this.buffer.indexOf("\n");
      }
    });
    child.on("exit", () => {
      this.process = null;
      // 待っている側を解放する。落ちたまま待ち続けると先へ進めない。
      for (const waiter of this.waiters.splice(0)) waiter("exit");
    });

    this.process = child;
    return child;
  }

  /** 1 行送る。 */
  send(line: string): void {
    this.ensureProcess().stdin.write(`${line}\n`);
  }

  /** プロセスを先に起こしておく。最初の 1 件で起動を待たずに済む。 */
  warmUp(): void {
    this.ensureProcess();
  }

  /**
   * 次の 1 行を待つ。
   *
   * 待ちきれずに諦めたあとも、待ち手は並びに残す。
   * 外してしまうと、遅れて届いた行を次の待ち手が受け取る。
   * 以降ずっと 1 行ずれ、鳴っていない音に口パクが付く。
   * 残しておけば、遅れて来た行はここで捨てられる。
   */
  nextLine(): Promise<string> {
    return new Promise((resolve) => {
      let gaveUp = false;
      const timer = setTimeout(() => {
        gaveUp = true;
        resolve("timeout");
      }, RESPONSE_TIMEOUT_MS);
      const handler = (line: string) => {
        clearTimeout(timer);
        if (gaveUp) return;
        resolve(line);
      };
      this.waiters.push(handler);
    });
  }

  close(): void {
    if (!this.process) return;
    // 空行を送ると読み取りの繰り返しが終わる。
    this.process.stdin.write("\n");
    this.process.stdin.end();
    this.process = null;
  }
}
