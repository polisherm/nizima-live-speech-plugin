# nizima-live-speech-plugin

Live2D モデルに声・口パク・表情・字幕を付けて喋らせるツール。
nizima LIVE Plugin API（WebSocket）でモデルを操作し、VOICEVOX で声を作る。

2 体に会話させられる。台詞はその場で作らせても、書いた台本を読ませてもよい。

nizima LIVE の AI アシスタント機能は使わない。Plugin API で表情と口パクを直接動かす。

## 前提

- Windows
- Node.js（22 で動かしている）
- nizima LIVE 2.7 以上（ずんだもん・四国めたんのサンプルモデルが入った版）
- nizima LIVE のプラグイン機能が有効（プラグインマネージャーの上部トグル）
- VOICEVOX（音声合成に使う）
- Claude のサブスク、または API キー（`talk` と `fix-readings` を使うときだけ要る）

音声の再生、字幕の画像の作成にPowerShellを使うため、現状Windows専用となる。

## セットアップ

nizima LIVE と VOICEVOX を起動しておく。どちらも動いていないと繋がらない。

```
npm install
```

### nizima LIVE に登録する

次のコマンドで接続する。

```
npm run connect
```

初回はここで応答が止まる（5 分でタイムアウトする）。
nizima LIVE のプラグインマネージャー上で `nizima-live-speech-plugin` のトグルを有効にすると処理を開始する。
ターミナルに `接続・認証 OK` と出れば接続が成功している。

登録すると、認証トークンが `%APPDATA%/nizima-live-speech-plugin/state.json` に保存される。
次に接続するときは、これを使って自動で繋がる。
再登録したい場合はこのフォルダごと消す。

トークンは平文で置かれる（公式のサンプルと同様）。
Plugin API はローカルホスト限定で、リモートからは繋がらない（[仕様](https://github.com/Live2D/nizimaLIVEPluginAPI)）。
できるのも nizima LIVE のモデルの操作に限られるため、危険性は少ない。

接続先の既定は `ws://localhost:22022/`。
ポートはnizima LIVE上で変更可能。 変えたときは `config.local.json` の `nizimaUrl` も書き換えること。

### 口パク用のモデルを作る

**口パク用に複製する対象は、以下の 2 体に決め打ちしてある。**

* 「ずんだもん（坂本アヒル式）」
* 「四国めたん（坂本アヒル式）」

この 2 体を、先に nizima LIVE でダウンロードしておく。

どちらも表情とモーションが口の開き（`ParamMouthOpenY`）を動かす。
そのままだと口パクの指示が打ち消されて、口が動かない。
オリジナルには手を触れず、複製から口の開きだけを取り除いて使う。

```
npx tsx src/setup/make-talk-models.ts           # ファイルは書き換えず、何をするかだけ出す
npx tsx src/setup/make-talk-models.ts --apply   # 複製を作って口の開きを取り除く
```

`modelsRoot` の下に `zundamon_talk` と `shikoku_metan_talk` ができる。
次の手順から先は、この複製のほうを使う。

複製には「ずんだもん（口パク用）」「四国めたん（口パク用）」の名前が付く。
この名前がモデル一覧に出るのは、nizima LIVE を再起動したあと。
それまでは、モデル一覧に元と同じ名前で並ぶ。

別のモデルを使うときは、`src/setup/make-talk-models.ts` に手を入れる。

- `TARGETS` に、元のフォルダ名・元の基準名・複製後のフォルダ名・複製後の基準名と、
  画面に出す名前（`destNames`）を足す
- 口の開きが `ParamMouthOpenY` でなければ、`MOUTH_OPEN` の値も変える。
  この ID は Cubism 側で付け替えられるため、モデルによって違う

### 素の顔と姿勢へ戻せるようにする

複製ができたら、喋り終わったあとに素へ戻すためのモーションと表情を作る。
どちらも `mtn_idle` と `exp_reset` という名前で探すので、コマンドで作る。

```
npx tsx src/setup/make-idle-motion.ts zundamon_talk shikoku_metan_talk
npx tsx src/setup/make-reset-expression.ts zundamon_talk shikoku_metan_talk
```

- `make-idle-motion.ts` — 待機モーションを作る。モーションが動かした値は、
  止めても既定へ戻らない。別のモーションへ乗り換えるとフェードがかかるので、
  「何も動かさないモーション」を用意して、そこへ乗り換える
- `make-reset-expression.ts` — 素の表情を作る。表情は値を加算するため、
  止めても汗や眉が顔に残る。既定値を上書きする表情を作って、そこへ戻す

書き込む先はモデルのフォルダで、`model3.json` も書き換える。

### モデルを画面に出す

複製した 2 体を nizima LIVE の画面へ並べる。喋る相手が画面にいないと何も起きない。

まず、表示可能なモデルの一覧を見る。

```
npx tsx src/cli/scene/list-models.ts
```

登録済みのモデルと、その `model3.json` のパスがターミナルに出る。
`zundamon_talk` と `shikoku_metan_talk` のパスを控える。

次に、1 体ずつ画面へ足す。

```
npx tsx src/cli/scene/add-model.ts "<model3.json のパス>"
```

追加先は、最後に触った nizima LIVE のウィンドウ（シーン）。
並べ終わったら、位置と大きさは nizima LIVE の画面で整える。

### Claude の認証

`talk` と `fix-readings` は Claude Agent SDK を使う。認証のしかたは 2 つある。

1. **Claude のサブスクで動かす。** Claude Code にログインしていれば、そのままで動く。
   使ったぶんはサブスクの利用上限から引かれる
   （[Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)）。

2. **API キーで動かす。** キーは [Claude Console](https://platform.claude.com/) で発行して、環境変数へ置く。

   ```
   $env:ANTHROPIC_API_KEY = "<キー>"   # PowerShell
   export ANTHROPIC_API_KEY=<キー>     # bash
   ```

SDK は `.env` を自動では読まない。シェルの環境変数として渡す。
詳細は [Agent SDK のドキュメント](https://code.claude.com/docs/en/agent-sdk/quickstart)にある。

`cast` と `speak` は台本を読ませるだけで Claude を使わないため、認証も不要。

## 使い方

お題から会話を作り、気に入った回を読ませるまでの流れ。
セットアップと同じく、nizima LIVE と VOICEVOX を起動しておく。

### 1. 喋らせる

```
npm run talk -- "<お題>" 2
```

お題を渡すと、その場で台詞を作りながら 2 体が会話する。第 2 引数は往復数。
声・口パク・表情・字幕は、台詞に合わせて自動で付く。字幕は話者ごとに色が変わる。
終わると台本が `takes/` に残る。同じお題でも毎回ちがう内容になるため、
気に入った回はここから読み直す。

### 2. 読みを直す

```
npm run fix-readings -- takes/<ファイル>.txt
```

読み上げたときの音を VOICEVOX から取り、台詞と並べて Claude に渡す。
意味と合っていない語が見つかれば、読みを付けて書き戻す。

`talk` も台詞ごとに同じことをしている。ただし喋りながらなので軽く済ませている。
ここでは再生の速さを気にしないため、直しの精度を上げてある。

Claude へ問い合わせるぶん数分かかる。仕上げる回にだけかければよい。

### 3. 読ませる

```
npm run cast -- takes/<ファイル>.txt
```

台本を読ませる。同じ内容を何度でも再生できる。
台本はテキストなので、言い回しを手で直してから読ませることもできる。

録画するなら、画面録画ソフト（OBS など）を使う。このツールは動画を出さない。

外に出すなら、先にクレジットを nizima LIVE の画面へ置く。
VOICEVOX の利用規約は、利用したことが分かるクレジット表記を求めている。

```
npm run credit            # 置く
npm run credit -- --off   # 消す
```

「VOICEVOX: 四国めたん・ずんだもん」を画像として画面の隅に置く。
置いたあとの位置と大きさは、nizima LIVE 上で手でも動かせる。

### 渡した文をそのまま喋らせる

会話も台本も通さず、その場で 1 文を読ませる。字幕は出ない。

```
npm run speak -- "<テキスト>" [話者ID] [表情名]
echo "<Markdown>" | npm run speak -- --stdin --format
```

`--format` を付けると、読み上げ向けに整形する。

- 見出しの記号を落とす
- 表とコードブロックを「省略」に置き換える
- 冒頭 3 文だけを読む

付けなければ、渡した文をそのまま全部読む。

外のプログラムから呼ぶ入口として使える。

### 走らせるときのフラグ

その回だけ切り替えるものは、フラグで渡す。位置はどこでもよい。

| フラグ            | 効果                                   | 使えるコマンド    |
|-------------------|----------------------------------------|-------------------|
| `--no-subtitle`   | 字幕を出さない                         | `talk` / `cast`   |
| `--no-speak`      | 喋らせず、台本だけ作る                 | `talk`            |
| `--no-face-front` | 正面へ向け続けるのをやめる             | `cast`            |
| `--style "..."`   | 掛け合いの運び方を、その回だけ注文する | `talk`            |
| `--stdin`         | テキストを標準入力から読む             | `cast` / `speak`  |
| `--format`        | Markdown を読み上げ向けに整形する      | `speak`           |

```
npm run talk -- "夏の暑さのしのぎ方" 2 --no-speak
npm run cast -- takes/<ファイル>.txt --no-subtitle
```

デバッグに使うものは、環境変数で渡す。実行の全体に効かせたいため。

| 変数              | 効果                                       |
|-------------------|--------------------------------------------|
| `SUBTITLE_KEEP=1` | 出した字幕の画像を消さずに残す             |
| `NIZIMA_TRACE=1`  | クラッシュしたときにスタックトレースを出す |

## そのほかのコマンド

```
npm run connect     # nizima LIVE に接続する。登録もここで済ませる
npm run status      # 画面のモデルと、その表情・モーションの一覧を出す
npm run calm-down   # 動きっぱなしになったモデルを素へ戻す
npm run check       # 型チェック
```

## 設定

既定値は以下の通り。

変えたい項目があるときは、リポジトリ直下に `config.local.json` を作り、その項目だけ書く。
書かなかった項目は既定のまま動く。書き方は `config.example.json` を見る。

| 項目                  | 既定                                  | 何に使うか                      |
|-----------------------|---------------------------------------|---------------------------------|
| `personaDir`          | `personas/`                           | ペルソナ定義の置き場            |
| `modelsRoot`          | `%APPDATA%/Live2D/nizima LIVE/models` | nizima LIVE のモデルの置き場    |
| `nizimaUrl`           | `ws://localhost:22022/`               | nizima LIVE Plugin API の繋ぎ先 |
| `voicevoxUrl`         | `http://127.0.0.1:50021`              | VOICEVOX Engine の待ち受け先    |
| `voicevoxMaxPauseSec` | `0.35`                                | 読点の無音を抑える上限（秒）    |
| `voicevoxPauseScale`  | `1`                                   | VOICEVOX へ渡す無音の倍率       |
| `talkModel`           | `claude-sonnet-5`                     | 発言を作るモデル                |
| `verifyModel`         | `claude-sonnet-5`                     | 読み間違いを見つけるモデル      |
| `subtitleWithName`    | `true`                                | 字幕に話者名を出すか            |

`nizimaUrl` と `voicevoxUrl` の既定は、どちらもアプリ側が決めたポートに合わせてある。
変えた人だけが書き換える。

`voicevoxMaxPauseSec` は VOICEVOX 側の設定ではない。
VOICEVOX は読点の前に来る語で黙る長さを変え、感動詞のあとは長くとる。
ひとりで語るならこれでよいが、掛け合いでは間延びして聞こえる。
長すぎるものだけを、このツールが後から抑えている。

## 仕組み

### フォルダ構成

```
src/
  config.ts  設定。どこからも参照するので直下に置く
  nizima/    nizima LIVE との通信と、レスポンスの型
  voice/     音声合成と再生。VOICEVOX と PowerShell
  script/    台詞の記法。パース・整形・読みの確認・台本
  stage/     画面に出すもの。字幕とクレジット
  perform/   演じる。モデルの定義・感情・喋らせる
  cli/       CLI の入口。npm run で呼べるものが直下に並ぶ
    talk/      お題から会話を作って喋らせる。プロンプトの組み立てと生成を分けてある
    scene/     シーンにモデルを並べる。整えるときだけ使う
  probe/     デバッグ用のスクリプト。用途で分けてある
    inspect/   何があるか見る。表情・パラメータ・アイテム・既定値からのずれ・字幕の文字列
    mouth/     口パクが動かないときの切り分け
    listen/    声を聞き比べる
    play/      再生して目で見る
  setup/     モデルの加工。複製・待機モーション・素の表情を作る
scripts/     字幕を描く PowerShell スクリプト
personas/    ペルソナ定義。会話の system prompt として読む
takes/       台本の置き場。sample- で始まるものだけ記法の見本として残してある
```

### ペルソナ定義

`personas/` に 1 キャラ 1 ファイルで置く。中身は話し方と性格の指定。

このリポジトリに入れてあるのは、ずんだもんと四国めたんの 2 体ぶん。
[東北ずん子・ずんだもんプロジェクトのガイドライン](https://zunko.jp/guideline.html)に沿った二次創作物として置いている。
このリポジトリのライセンスは適用しない。

別の置き場を使うときは `config.local.json` の `personaDir` を書き換える。

### キャラクターの定義

`src/perform/models.ts` に、キャラクターの定義を置く。
Live2D モデル・声・ペルソナ定義を 1 つに集約したオブジェクト。
キャラクターと Live2D モデルは 1 対 1 で結びつく。

- nizima LIVE 側のモデル名
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

パースするのは `src/script/line-parser.ts` の 1 か所だけ。
以降は `Part` の並びとして扱うため、切る位置が記法の途中に来ることが起きない。

## 開発

ここから下は、このリポジトリに手を入れる人向け。使うだけなら読まなくてよい。

### fork するとき

nizima LIVE のプラグインマネージャーには、名前・開発者・版の 3 つが出る。
別物として登録するなら、`src/nizima/client.ts` の `PLUGIN_NAME` と
`PLUGIN_DEVELOPER` を書き換える。

`PLUGIN_NAME` はトークンの置き場（`%APPDATA%` の下のフォルダ名）にも使う。
変えると登録からやり直しになる。

### バージョン

`package.json` の `version` が正本。nizima LIVE のプラグインマネージャーに出る版も、ここから読む。

上げ方の目安。

| 上げる桁 | 何が変わったとき                                                     |
|----------|----------------------------------------------------------------------|
| major    | コマンド名や引数の意味が変わる。設定項目が消える。台詞の記法が変わる |
| minor    | コマンドが増える。設定項目が増える                                   |
| patch    | 挙動を直した。文言を直した                                           |

コミットは好きなだけ積んでよい。区切りたくなったところで、まとめて 1 つのリリースにする。

```
npm version patch          # package.json を上げ、コミットしてタグを打つ
git push --follow-tags
gh release create v0.1.1 --generate-notes
```

`--generate-notes` が、前のタグからのコミットを読んで変更の一覧を作る。
`npm version` は、コミットしていない変更が残っていると止まる。

## ライセンス

MIT ライセンス。詳細は [LICENSE](./LICENSE) を見る。

ただし `personas/` は対象外。二次創作物のため、このリポジトリのライセンスを適用しない。

## 関連

- [nizimaLIVEPluginAPI](https://github.com/Live2D/nizimaLIVEPluginAPI) — プロトコル仕様
