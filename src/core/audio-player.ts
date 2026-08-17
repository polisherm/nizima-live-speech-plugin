import { PwshWorker } from "./pwsh-worker.js";

/**
 * wav を鳴らす。
 *
 * Windows で追加インストールなしに音を鳴らせるのは Media.SoundPlayer で、
 * PowerShell から呼ぶ。プロセスは起動したままにして使い回す。
 *
 * 読み込みを終えた時点で ready を返させる。
 * 起動しただけの時点を再生開始と見なすと、そのぶん口パクが音より先に進む。
 */

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$player = New-Object Media.SoundPlayer",
  "while ($true) {",
  "  $path = [Console]::In.ReadLine()",
  "  if ([string]::IsNullOrEmpty($path)) { break }",
  "  try {",
  "    $player.SoundLocation = $path",
  "    $player.Load()",
  "    [Console]::Out.WriteLine('ready')",
  "    $player.PlaySync()",
  "  } catch {",
  "    [Console]::Out.WriteLine('error')",
  "  }",
  "  [Console]::Out.WriteLine('done')",
  "}",
].join("; ");

export class AudioPlayer {
  private readonly worker = new PwshWorker(SCRIPT);

  /**
   * wav を鳴らす。読み込みが終わった時点で onReady を呼び、鳴り終わるまで待つ。
   *
   * onReady から口パクを始めれば、音の始まりと口の動き出しが揃う。
   */
  async play(wavPath: string, onReady: () => void): Promise<void> {
    this.worker.send(wavPath);

    // done が来るまで読み切る。
    // 途中で抜けると次の再生が前の行を受け取り、以降ずっと 1 行ずれる。
    // ずれた状態では、鳴っていない音に口パクが付く。
    for (;;) {
      const line = await this.worker.nextLine();
      if (line === "ready") {
        onReady();
        continue;
      }
      if (line === "error") {
        console.error(`音声の再生に失敗: ${wavPath}`);
      }
      // done / error / timeout / exit のいずれかで 1 件が終わる。
      break;
    }
  }

  /** プロセスを先に起こしておく。最初の再生で起動を待たずに済む。 */
  warmUp(): void {
    this.worker.warmUp();
  }

  close(): void {
    this.worker.close();
  }
}
