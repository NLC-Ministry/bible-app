"""把 align.py／check.py 包成一份 Kaggle 程式碼，在免費 GPU 上跑全部章節（#637）。

Kaggle 上沒有這個 repo，所以兩支腳本和書卷清單都直接嵌進產生出來的 run.py。
音檔放 /kaggle/temp（不會被存成輸出），時間表、檢查報告和抽聽頁放 /kaggle/working（跑完可下載）。

用法：
  python scripts/human-audio-timing/kaggle_kernel.py --dir <資料夾> --kernel-id <帳號>/<slug> --all
  kaggle kernels push -p <資料夾>
  kaggle kernels status <帳號>/<slug>
  kaggle kernels output <帳號>/<slug> -p <下載資料夾>

帳號名稱只在執行時傳入，不要寫進 repo。
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

RUNNER = r'''
# 自動產生（scripts/human-audio-timing/kaggle_kernel.py），不要手改。
import base64, json, os, subprocess, sys, time
from pathlib import Path

FILES = json.loads(base64.b64decode("{files}").decode("utf-8"))
CHAPTER_ARGS = {chapter_args}

code = Path("/kaggle/temp/code"); code.mkdir(parents=True, exist_ok=True)
for name, text in FILES.items():
    (code / name).write_text(text, encoding="utf-8")

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "pypinyin", "soundfile>=0.12"], check=True)
subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv"], check=False)

work, out = "/kaggle/temp/work", "/kaggle/working/out"
began = time.time()
align = subprocess.run([sys.executable, str(code / "align.py"), "--work", work, "--out", out,
                        "--books", str(code / "books.json"), "--prefetch", "4", *CHAPTER_ARGS])
print(f"對齊結束，exit {{align.returncode}}，共 {{(time.time() - began) / 60:.0f}} 分鐘", flush=True)
subprocess.run([sys.executable, str(code / "check.py"), "--work", work, "--out", out,
                "--report", "/kaggle/working/check-report.json", "--review", "/kaggle/working/review.html"])
'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", required=True, type=Path, help="產生 run.py 與 kernel-metadata.json 的資料夾")
    parser.add_argument("--kernel-id", required=True, help="<Kaggle 帳號>/<slug>")
    parser.add_argument("--title", default="bible verse timing")
    parser.add_argument("--chapters", nargs="*", help="書卷編號:章")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if bool(args.all) == bool(args.chapters):
        raise SystemExit("--all 和 --chapters 二選一")

    args.dir.mkdir(parents=True, exist_ok=True)
    books = args.dir / "books.json"
    subprocess.run([sys.executable, str(HERE / "align.py"), "--work", str(args.dir), "--dump-books", str(books)], check=True)
    files = {
        "align.py": (HERE / "align.py").read_text(encoding="utf-8"),
        "check.py": (HERE / "check.py").read_text(encoding="utf-8"),
        "books.json": books.read_text(encoding="utf-8"),
    }
    books.unlink()
    encoded = base64.b64encode(json.dumps(files, ensure_ascii=False).encode("utf-8")).decode("ascii")
    chapter_args = ["--all"] if args.all else ["--chapters", *args.chapters]
    (args.dir / "run.py").write_text(RUNNER.format(files=encoded, chapter_args=json.dumps(chapter_args)), encoding="utf-8")
    (args.dir / "kernel-metadata.json").write_text(json.dumps({
        "id": args.kernel_id,
        "title": args.title,
        "code_file": "run.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": True,
        "enable_gpu": True,
        "machine_shape": "NvidiaTeslaT4",
        "enable_internet": True,
        "dataset_sources": [],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }, indent=2), encoding="utf-8")
    print(f"已產生 {args.dir / 'run.py'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
