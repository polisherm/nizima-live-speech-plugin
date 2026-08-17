# 台詞を透過 PNG に描く。nizima LIVE のアイテムとして画面に置く用。
#
# System.Drawing を使う。Windows 標準なので追加インストールは要らない。
# 文字は指定色、縁取りは黒。背景は透過。モデルや背景の上に重ねても読める。
#
# 画像のサイズは常に固定する。
# nizima のアイテムは画像全体を一定の大きさに収めて表示するため、
# 内容によって画像が縦に伸びると、その分だけ文字が小さくなって読めなくなる。
# 収まらない台詞は末尾を切る。音声では全文を喋るので、字幕は読める範囲だけでよい。
#
# 使い方:
#   pwsh -NoProfile -File render-subtitle.ps1 -Text "台詞" -OutPath "C:/path/out.png"

param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$OutPath,
    [int]$FontSize = 40,
    [int]$Width = 1600,
    [int]$MaxLines = 2,
    [string]$FontFamily = "Yu Gothic UI",
    [string]$Color = "#FFFFFF"
)

Add-Type -AssemblyName System.Drawing

$font = New-Object System.Drawing.Font($FontFamily, $FontSize, [System.Drawing.FontStyle]::Bold)

$padding = 16
$layoutWidth = $Width - ($padding * 2)

# 1 行の高さから、画像の高さを固定で決める。
$lineHeight = [int][Math]::Ceiling($font.GetHeight())
$height = ($lineHeight * $MaxLines) + ($padding * 2)

$measureBitmap = New-Object System.Drawing.Bitmap(1, 1)
$measureGraphics = [System.Drawing.Graphics]::FromImage($measureBitmap)
$measureGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

# 文字の輪郭を作る道具。測るときと描くときで同じものを使う。
#
# 幅を MeasureString で測り、描くのは GraphicsPath という作りだった。
# 2 つは字送りの求め方が違い、測って入ると出た行が、描くと枠から溢れる。
# 溢れた分は描かれず、末尾が黙って消える。
$family = New-Object System.Drawing.FontFamily($FontFamily)

# 文字の大きさはピクセルで指定する。Font のポイント指定から換算する。
#
# 字を小さくして入れ直すとき、ここも一緒に動かす。
# 描く側が元の大きさを見ていると、小さくしたつもりが画像に効かない。
$currentFontSize = $FontSize
$emSize = $currentFontSize * $measureGraphics.DpiY / 72

# 文字の置き方。測るときと描くときで同じものを使う。
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

# 行に分ける。
# 幅は実測する。文字数から見積もると、
# 文字ごとの幅の違いや行頭の話者名のぶんでずれて、1 文字だけの行が残る。
#
# 切る位置は / を第 1 候補にし、次に句読点、次に助詞。
#
# / は「ここで折ってよい」という印であって、必ず折る位置ではない。
# 印の数だけ行を作ると 2 行に収まらず、入りきらない分が消える。
# そこで 2 度試す。1 度目で余ったら、印を候補から外して割り直す。
# 全文を見せることを、切れ目の見栄えより優先する。
$fits = {
    param($s)
    if ([string]::IsNullOrWhiteSpace($s)) { return $true }
    $probe = New-Object System.Drawing.Drawing2D.GraphicsPath
    try {
        # 描くときと同じ枠に入れる。枠に入れれば、描く側と同じ折り返しが起きる。
        # 高さで見れば、1 行に収まったかどうかがそのまま分かる。
        $probeRect = New-Object System.Drawing.RectangleF(0, 0, $layoutWidth, 100000)
        $probe.AddString(
            $s, $family, [int][System.Drawing.FontStyle]::Bold, $emSize,
            $probeRect, $format)
        # 空白だけの並びは輪郭を持たない。収まるものとして扱う。
        if ($probe.PointCount -eq 0) { return $true }
        # 輪郭の高さは行の高さより低い。折り返せば行の高さぶんだけ増える。
        # 間を取った値で見れば、1 行と 2 行を分けられる。
        $probe.GetBounds().Height -le ($font.GetHeight() * 1.4)
    } finally {
        $probe.Dispose()
    }
}

$layout = {
param($useMarkers)

$lines = New-Object System.Collections.Generic.List[string]
$rest = $Text

while ($rest.Length -gt 0 -and $lines.Count -lt $MaxLines) {
    if ((& $fits $rest)) {
        $lines.Add($rest)
        $rest = ""
        break
    }

    # 入る最大の文字数を求める。
    $take = $rest.Length
    while ($take -gt 1 -and -not (& $fits $rest.Substring(0, $take))) {
        $take--
    }

    $window = $rest.Substring(0, $take)

    # 括弧の内側では切らない。引用がひとまとまりで読めなくなる。
    # 位置ごとに、そこが括弧の中かどうかを調べておく。
    $inQuote = New-Object bool[] ($window.Length + 1)
    $depth = 0
    for ($i = 0; $i -lt $window.Length; $i++) {
        if ("「『（(【".Contains($window[$i])) { $depth++ }
        $inQuote[$i + 1] = ($depth -gt 0)
        if ("」』）)】".Contains($window[$i])) { $depth = [Math]::Max(0, $depth - 1) }
    }

    # 行頭に置けない文字。ここが次の行の先頭になる切り方は避ける。
    $noStart = "っッゃゅょャュョーぁぃぅぇぉァィゥェォ、，。！？」』）)】"

    # 第 1 候補は / の位置。発言を作った側が意味の切れ目として入れたもの。
    # 語の途中で切らないための知識は、こちらのルールでは持てない。
    #
    # 2 度目は候補から外す。印どおりに折ると入りきらなかった、ということ。
    $cut = 0
    if ($useMarkers) {
        $at = $window.LastIndexOf('/')
        if ($at -ge 0) { $cut = $at + 1 }
    }

    # マーカーが無いときだけ、句読点で切る。
    if ($cut -le 0) {
        foreach ($mark in @("、", "。", "…", "！", "？")) {
            $found = $window.LastIndexOf($mark)
            if ($found -lt 0 -or $inQuote[$found + 1]) { continue }
            if ($found + 1 -lt $rest.Length -and $noStart.Contains($rest[$found + 1])) { continue }
            if (($found + 1) -gt $cut) { $cut = $found + 1 }
        }
    }
    # 括弧の外に切れ目が無いときは、括弧の外側で切る。
    #
    # 見るのは前と後ろの両方にする。前だけを見ると、括弧が長いときに
    # 1 行目が数文字で終わり、残りが 2 行目に押し込まれる。
    # 押し込まれた行は入りきらず、字を小さくして詰めることになる。
    #
    # 選ぶのは、残りの長さの半分に近いほう。行の長さがそろう。
    if ($cut -le 0) {
        $opening = 0
        $closing = 0
        for ($i = $window.Length - 1; $i -gt 0; $i--) {
            if ($opening -le 0 -and "「『（(【".Contains($window[$i])) { $opening = $i }
            if ($closing -le 0 -and "」』）)】".Contains($window[$i])) { $closing = $i + 1 }
        }
        $half = $rest.Length / 2
        foreach ($candidate in @($opening, $closing)) {
            if ($candidate -le 0) { continue }
            if ($cut -le 0 -or
                [Math]::Abs($candidate - $half) -lt [Math]::Abs($cut - $half)) {
                $cut = $candidate
            }
        }
    }
    if ($cut -le 0) {
        # 幅で切るしかない。ただし行頭に置けない文字が次に来るなら 1 文字ずつ手前へ寄せる。
        $cut = $take
        while ($cut -gt 1 -and $cut -lt $rest.Length -and $noStart.Contains($rest[$cut])) {
            $cut--
        }
    }

    $lines.Add($rest.Substring(0, $cut))
    $rest = $rest.Substring($cut)

    # 次の行が句読点で始まらないようにする。前の行の末尾へ送る。
    while ($rest.Length -gt 0 -and "、，。！？…".Contains($rest[0])) {
        $lines[$lines.Count - 1] += $rest[0]
        $rest = $rest.Substring(1)
    }
}

# 行と、入りきらなかった残りを返す。
[PSCustomObject]@{ Lines = $lines; Rest = $rest }
}

# 1 度目は印どおりに折る。入りきらなければ、印を外して割り直す。
$result = & $layout $true
if ($result.Rest.Length -gt 0) {
    $retry = & $layout $false
    if ($retry.Rest.Length -eq 0) { $result = $retry }
}

# それでも余るなら、字を小さくして入れる。
#
# 1 行に何字入るかは字の幅で決まる。同じ字数でも、漢字が続けば横に長い。
# 渡す側は字数でしか測れないため、幅で溢れる台詞はどうしても出る。
# 末尾を切って意味を欠けさせるより、少し小さくして全部見せる。
$shrink = 0
while ($result.Rest.Length -gt 0 -and $shrink -lt 6) {
    $shrink++
    # 測る側と描く側の両方に効かせる。片方だけ動かすと、
    # 小さくしたつもりの行が元の大きさで描かれて、また溢れる。
    $currentFontSize = $FontSize - $shrink * 4
    $emSize = $currentFontSize * $measureGraphics.DpiY / 72
    $font.Dispose()
    $font = New-Object System.Drawing.Font($FontFamily, $currentFontSize, [System.Drawing.FontStyle]::Bold)
    $result = & $layout $true
    if ($result.Rest.Length -gt 0) {
        $retry = & $layout $false
        if ($retry.Rest.Length -eq 0) { $result = $retry }
    }
}

$lines = $result.Lines
$rest = $result.Rest

# 2 行に割れて、最終行が極端に短いときは、長さが近くなる位置で割り直す。
# 前の行が満杯だと送り込みでは直らないため、切る位置そのものを動かす。
if ($rest.Length -eq 0 -and $lines.Count -eq 2 -and $lines[1].Length -le 4) {
    $joined = $lines[0] + $lines[1]
    $half = [int]($joined.Length / 2)
    $best = 0
    $depth = 0
    for ($i = 1; $i -lt $joined.Length; $i++) {
        if ("「『（(【".Contains($joined[$i - 1])) { $depth++ }
        if ("」』）)】".Contains($joined[$i - 1])) { $depth = [Math]::Max(0, $depth - 1) }
        if ($depth -gt 0) { continue }
        $isBreak = "、，。！？…".Contains($joined[$i - 1]) -or "はがをにでとへもや".Contains($joined[$i - 1])
        if (-not $isBreak) { continue }
        if ($best -eq 0 -or [Math]::Abs($i - $half) -lt [Math]::Abs($best - $half)) { $best = $i }
    }
    if ($best -gt 0) {
        $head = $joined.Substring(0, $best)
        $tail = $joined.Substring($best)
        # 割り直した結果が両方とも幅に収まるときだけ採用する。
        if ((& $fits $head) -and (& $fits $tail)) {
            $lines[0] = $head
            $lines[1] = $tail
        }
    }
}

# 改行位置のマーカーを消す。行に割り終えた後なので、表示には出さない。
for ($i = 0; $i -lt $lines.Count; $i++) {
    $lines[$i] = $lines[$i] -replace '\s*/\s*', ''
}

# 行末の読点と三点リーダを落とす。改行そのものが間を表すので、重複した表現になる。
# 句点は文の終わりを示すため残す。
for ($i = 0; $i -lt $lines.Count; $i++) {
    $lines[$i] = $lines[$i] -replace '[、，]$', ''
    $lines[$i] = $lines[$i] -replace '[…‥]+$', ''
}

if ($rest.Length -gt 0 -and $lines.Count -gt 0) {
    # 収まらなかった分がある。最終行の末尾を省略記号に置き換える。
    $last = $lines[$lines.Count - 1]
    while ($last.Length -gt 1 -and -not (& $fits ($last + "…"))) {
        $last = $last.Substring(0, $last.Length - 1)
    }
    $lines[$lines.Count - 1] = $last + "…"
}

$body = [string]::Join("`n", $lines)

$measureGraphics.Dispose()
$measureBitmap.Dispose()

$bitmap = New-Object System.Drawing.Bitmap($Width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$rectHeight = $height - ($padding * 2)
$rect = New-Object System.Drawing.RectangleF($padding, $padding, $layoutWidth, $rectHeight)

# 文字の輪郭をパスとして取り出し、縁を線として描く。
#
# 文字を 8 方向にずらして描く方式は使わない。
# 斜め方向だけ距離が伸びるうえ、45 度刻みでは文字の凸角で縁が尖って飛び出す。
# パスに対して線を引き、角の継ぎ方を丸めれば、太さが一定で角も出ない。
$path = New-Object System.Drawing.Drawing2D.GraphicsPath

# 大きさは行に割ったときのものをそのまま使う。
# ここで測り直すと、字を小さくして入れ直したぶんが失われる。
$path.AddString($body, $family, [int][System.Drawing.FontStyle]::Bold, $emSize, $rect, $format)

$outlineWidth = [Math]::Max(2, $emSize / 10)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(240, 0, 0, 0), $outlineWidth)
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$pen.MiterLimit = 1
$graphics.DrawPath($pen, $path)

$brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Color))
$graphics.FillPath($brush, $path)

$bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bitmap.Dispose()
$font.Dispose()
$brush.Dispose()
$pen.Dispose()
$path.Dispose()
$family.Dispose()

# 検証しやすいよう、行ごとの長さも出す。1 文字だけの行が出ていないかを画像なしで判定できる。
$lineLengths = ($lines | ForEach-Object { $_.Length }) -join ","
Write-Output "$Width x $height / $($body.Length) 文字 / 行 [$lineLengths]"
