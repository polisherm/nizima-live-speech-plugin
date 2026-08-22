"""口パクが通るモデルの複製を作る。

nizima が持つ元のモデルには手を触れない。フォルダごと複製し、複製側の表情と
モーションから、口の開き（ParamMouthOpenY）だけを取り除く。

表情は口の開きを Add で加算する。加算値が 1 だと、口パクが何を送っても上限に
張り付いて動かなくなる。モーションも同じく口を動かし、こちらは口パクより後に
効くため、値をどこへ送っても上書きされる。

口の形（ParamMouthForm）とパターン（ParamPatternMouth）は残す。
笑った口の形のまま開閉できる。

複製先が既にあるときは、中の表情とモーションだけを処理し直す。

    python scripts/make-talk-models.py          # 対象を出すだけ
    python scripts/make-talk-models.py --apply  # 実際に作る
"""

import json
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def models_root() -> Path:
    """nizima がモデルを置くフォルダを決める。

    既定は APPDATA の下。config.local.json に modelsRoot があれば、そちらを使う。
    設定の形は src/config.ts と揃えてある。
    """
    default = Path(os.environ.get("APPDATA", "")) / "Live2D" / "nizima LIVE" / "models"

    config_file = REPO_ROOT / "config.local.json"
    if not config_file.exists():
        return default

    config = json.loads(config_file.read_text(encoding="utf-8"))
    return Path(config.get("modelsRoot", default))


MODELS_ROOT = models_root()

# (元フォルダ名, 元の基準名, 複製後のフォルダ名, 複製後の基準名)
TARGETS = [
    (
        "nizima_official_zundamon_ahirushiki",
        "zundamon",
        "zundamon_talk",
        "zundamon_talk",
    ),
    (
        "nizima_official_shikoku_metan_ahirushiki",
        "shikoku_metan",
        "shikoku_metan_talk",
        "shikoku_metan_talk",
    ),
]

# 基準名に追従してリネームする拡張子。
# model3 は nizima 上の表示名になる。live は nizima 固有の設定で、
# model3 と同じ名前で探される可能性があるため揃える。
RENAMED_SUFFIXES = [".model3.json", ".live.json"]

MOUTH_OPEN = "ParamMouthOpenY"

# モーションから外して表情に任せる値。
#
# 表情は切り替えるたびに前のものが止まるため、確実に消える。
# モーションは発言のあいだ流れ続けるため、途中で気持ちが変わっても残る。
# 驚いて出た汗が、笑っている場面まで残って見える。
#
# 同じ値を表情側が持っているものだけを対象にする。表現は失われない。
MOTION_ONLY_STRIP = ("ParamSweat",)

apply = "--apply" in sys.argv


def strip_mouth_open(path: Path) -> int:
    """表情から口の開きを取り除く。取り除いた件数を返す。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    before = data.get("Parameters", [])
    after = [p for p in before if p.get("Id") != MOUTH_OPEN]
    removed = len(before) - len(after)
    if removed and apply:
        data["Parameters"] = after
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent="\t"), encoding="utf-8"
        )
    return removed


def strip_motion_mouth(path: Path) -> int:
    """モーションから口の開きのカーブを取り除く。取り除いた件数を返す。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    before = data.get("Curves", [])
    drop = (MOUTH_OPEN,) + MOTION_ONLY_STRIP
    after = [
        c
        for c in before
        if not (c.get("Target") == "Parameter" and c.get("Id") in drop)
    ]
    removed = len(before) - len(after)
    if removed and apply:
        data["Curves"] = after
        # カーブの数は数え直す。
        # セグメントと点の合計は減らさない。多いぶんには読み込みで困らず、
        # 正しく数え直すにはカーブの形式ごとの解釈が要る。
        data["Meta"]["CurveCount"] = len(after)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent="\t"), encoding="utf-8"
        )
    return removed


for source_dir, source_base, dest_dir, dest_base in TARGETS:
    source = MODELS_ROOT / source_dir
    dest = MODELS_ROOT / dest_dir

    print(f"\n=== {source_dir} → {dest_dir}")

    if not source.is_dir():
        print(f"  元フォルダが無い: {source}")
        continue

    # 複製先が既にあるなら、中の表情とモーションだけを処理し直す。
    already = dest.exists()
    if already:
        print(f"  複製先が既にある。中身だけ見直す")
    else:
        if apply:
            shutil.copytree(source, dest)
        print(f"  フォルダを複製")

    # 基準名に追従するファイルの改名。複製した直後だけ行う。
    if not already:
        for suffix in RENAMED_SUFFIXES:
            old = dest / f"{source_base}{suffix}"
            new = dest / f"{dest_base}{suffix}"
            if source_base == dest_base:
                continue
            if apply:
                if old.exists():
                    old.rename(new)
                else:
                    print(f"  改名の対象が無い: {old.name}")
                    continue
            elif not (source / f"{source_base}{suffix}").exists():
                print(f"  改名の対象が無い: {source_base}{suffix}")
                continue
            print(f"  改名 {source_base}{suffix} → {dest_base}{suffix}")

    # 出力を読む先。まだ複製していない下見のときは元を見る。
    motion_root = (dest if (apply or already) else source) / "motion"

    # 表情から口の開きを外す。
    total_files = 0
    total_removed = 0
    for expression in sorted(motion_root.glob("*.exp3.json")):
        removed = strip_mouth_open(expression)
        if removed:
            total_files += 1
            total_removed += removed
    print(f"  口の開きを外した表情: {total_files} 件 / 項目 {total_removed} 個")

    # モーションから口の開きのカーブを外す。
    motion_files = 0
    motion_removed = 0
    for motion in sorted(motion_root.glob("*.motion3.json")):
        removed = strip_motion_mouth(motion)
        if removed:
            motion_files += 1
            motion_removed += removed
    print(
        f"  口の開きを外したモーション: {motion_files} 件 / カーブ {motion_removed} 本"
    )

if not apply:
    print("\n--- 出力しただけ。実行するには --apply を付ける。")
