# nizima-agent-bridge

Live2D モデルに声・口パク・表情・字幕を付けて喋らせるツール。
nizima LIVE Plugin API（WebSocket）でモデルを操作し、VOICEVOX で声を作る。

2 体に会話させられる。台詞はその場で作らせても、書いた台本を読ませてもよい。

nizima LIVE の AI アシスタント機能は使わない。Plugin API で表情と口パクを直接動かす。

## 前提

- Node.js 22 以上
- nizima LIVE 2.7 以上（Plugin API 対応バージョン）
- nizima LIVE のプラグイン機能が有効（プラグインマネージャーの上部トグル）
- VOICEVOX（音声合成に使う）

## セットアップ

```
npm install
```

設定は要らない。既定値のまま動く。

変えたいところがあるときだけ、`config.example.json` を `config.local.json` として写し、
書き換えたい項目だけ残す。書かなかった項目は既定のまま動く。

| 項目 | 既定 | 何に使うか |
|---|---|---|
| `personaDir` | `personas/` | ペルソナ定義の置き場 |
| `pluginDeveloper` | `nizima-agent-bridge` | nizima の登録に出る開発者名 |
| `modelsRoot` | `%APPDATA%/Live2D/nizima LIVE/models` | 口パク用の複製を作る先 |

初回接続時に nizima LIVE 側へ登録通知が出る。
プラグインマネージャーで `nizima-agent-bridge` のトグルを有効にする。
取得したトークンは `state.json` に保存され、次回から自動で再接続する。

口パク用のモデルを用意する。元のモデルは表情やモーションが口を動かすため、
口パクが埋もれる。複製を作り、口の開きを外したものを使う。

```
python scripts/make-talk-models.py           # 対象を出すだけ
python scripts/make-talk-models.py --apply   # 実際に作る
npx tsx src/setup/make-idle-motion.ts        # 素の姿へ戻す待機モーションを作る
npx tsx src/setup/make-reset-expression.ts   # 素の顔へ戻す表情を作る
```

## 使い方

喋らせて、気に入った回を録画するまでの流れ。

### 1. 喋らせる

```
npm run discuss -- "<お題>" 2
```

お題を渡すと、その場で台詞を作りながら 2 体が会話する。第 2 引数は往復数。
終わると台本が `takes/` に残る。同じお題でも毎回ちがう内容になるため、
気に入った回はここから読み直す。

### 2. 読みを直す

```
npm run fix-readings -- takes/<ファイル>.txt
```

読み上げたときの音を VOICEVOX から取り、台詞と並べてモデルに見せる。
意味と合っていない語が見つかれば、読みを付けて書き戻す。

モデルへ問うぶん数分かかる。録画する回にだけかければよい。

### 3. 録画する

```
npm run cast -- takes/<ファイル>.txt
```

台本を読ませる。同じ内容を何度でも再生できるので、撮り直しが効く。
台本はテキストなので、言い回しを手で直してから読ませることもできる。

## そのほかのコマンド

```
npm run status      # 接続の確認。モデル・表情・モーションの一覧を出す
npm run calm-down   # 動きっぱなしになったモデルを素へ戻す
npm run credit      # 声のクレジットを画面に置く（--off で消す）
npm run check       # 型チェック
```

VOICEVOX の利用規約は、利用したことが分かるクレジット表記を求めている。
`npm run credit` は「VOICEVOX: 四国めたん・ずんだもん」を画像として画面の隅に置く。
録画して外に出すなら、これを出しておく。

置いたあとの位置と大きさは nizima の画面で手でも動かせる。

モデルをシーンへ並べる。

```
npx tsx src/cli/list-models.ts
npx tsx src/cli/add-model.ts "<model3.json のパス>"
```

## 構成

```
src/
  core/    ほかから使われる部品。通信・台詞の読み解き・音声・字幕・表情
  cli/     日常的に打つ入口
  probe/   実測ツール。挙動を確かめるのに使う
  setup/   モデルの加工。待機モーションと素の表情を作る
scripts/   PowerShell と Python。字幕の描画とモデルの複製
personas/  ペルソナ定義。会話の system prompt として読む
takes/     台本の置き場。sample- で始まるものだけ記法の見本として残してある
```

### ペルソナ定義

`personas/` に 1 キャラ 1 ファイルで置く。中身は話し方と性格の指定。

同梱してあるのは、ずんだもんと四国めたんの 2 体。
[東北ずん子・ずんだもんプロジェクトのガイドライン](https://zunko.jp/guideline.html)に沿った二次創作物として置いている。
このリポジトリのライセンスは適用しない。

別の置き場を使うときは `config.local.json` の `personaDir` を書き換える。

### モデルの定義

`src/core/models.ts` に、モデル 1 体ぶんをまとめてある。
キャラクターとモデルは 1 対 1 で結びつく。

- nizima 側のモデル名
- 普段の声（VOICEVOX の話者 ID）
- ペルソナ定義のファイル名（`personaDir` からの相対）
- 字幕の色
- 感情ごとの表情・モーション・声

新しいキャラを足すときは、ここに 1 つ加える。

声を変えるのは、聞いて違いが分かる感情だけにしている。
VOICEVOX のスタイルは声質の違いで、感情のために用意されたものではない。
合わないものに当てると、かえって不自然になる。

### 台詞の書き方

```
[smile] 朝ごはんの話ね。/ わたくしは断然、{米|コメ}だわ。
```

- `[smile]` — そこから先の表情。発言の途中に置けば、そこで顔が変わる
- `{語|ヨミ}` — 読みの指定。声にだけ効き、字幕には元の表記が出る
- `/` — 字幕を折り返してよい位置
- `『日常語――大げさな別名――』` — 画面には両方出て、声に出すのは別名だけ

実際に書いたものは `takes/sample-*.txt` にある。

読み解くのは `src/core/line-parser.ts` の 1 か所だけ。
以降は部品として扱うため、切る位置が記法の途中に来ることが起きない。

## 渡した文をそのまま喋らせる

会話も台本も通さず、その場で 1 文を読ませる。

```
npx tsx src/cli/speak.ts "<テキスト>" [話者ID] [表情名]
echo "<Markdown>" | npx tsx src/cli/speak.ts --stdin --format
```

- `--stdin` — テキストを標準入力から読む
- `--format` — Markdown を読み上げ向けに整形する。見出しの記号を落とし、
  表とコードブロックを「省略」に置き換え、冒頭 3 文だけを読む

`--format` を付けなければ、渡した文をそのまま全部読む。

外のプログラムから呼ぶ入口として使える。

## ライセンス

MIT ライセンス。詳細は [LICENSE](./LICENSE) を見る。

ただし `personas/` は対象外。二次創作物のため、このリポジトリのライセンスを適用しない。

## 関連

- [nizimaLIVEPluginAPI](https://github.com/Live2D/nizimaLIVEPluginAPI) — プロトコル仕様
