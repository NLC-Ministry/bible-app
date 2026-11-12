"""把 align.py／check.py 包成一份 Kaggle 程式碼或 Colab notebook，在免費 GPU 上跑全部章節（#637）。

Kaggle 要帳號完成手機驗證才有網路和 GPU；沒辦法驗證時用 --colab 產生 notebook，上傳到 Colab 全部執行。

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
DRIVE_DIR = "/content/drive/MyDrive/bible-verse-timing"
# torchaudio MMS_FA 權重（~/.cache/torch/hub/checkpoints/model.pt，1,262,047,414 bytes）的 SHA-256。
MMS_FA_MODEL_SHA256 = "20ef12963ab4924bef49ac4fc7f58ad5da2ee43b2c11bc8c853c9b90ecdbc680"

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


def bundle_files(tmp_dir: Path) -> str:
    """align.py、check.py 和書卷清單包成一段 base64，雲端那邊再寫回檔案。"""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    books = tmp_dir / "books.json"
    subprocess.run([sys.executable, str(HERE / "align.py"), "--work", str(tmp_dir), "--dump-books", str(books)], check=True)
    files = {
        "align.py": (HERE / "align.py").read_text(encoding="utf-8"),
        "check.py": (HERE / "check.py").read_text(encoding="utf-8"),
        "books.json": books.read_text(encoding="utf-8"),
    }
    books.unlink()
    return base64.b64encode(json.dumps(files, ensure_ascii=False).encode("utf-8")).decode("ascii")


def write_colab_notebook(target: Path, encoded: str, chapter_args: list[str]) -> None:
    """Google Colab 版：不需要手機驗證。執行中分頁要開著、電腦不能睡；跑完自動下載 zip。"""
    def code(source: str) -> dict:
        return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": source.strip("\n")}

    chapters = " ".join(chapter_args)
    # 時間表直接寫進雲端硬碟：Colab 中途斷線，重新「全部執行」會跳過已完成的章。
    out = f"{DRIVE_DIR}/out"
    cells = [
        {"cell_type": "markdown", "metadata": {}, "source": (
            "# 和合本朗讀逐節時間表（#637）\n"
            "1. 上方選單「執行階段 → 全部執行」。\n"
            "2. 跳出「允許存取 Google 雲端硬碟」時按允許：結果存在雲端硬碟的 `bible-verse-timing` 資料夾。\n"
            "   對齊模型的官方下載點連不上時，先把本機的 `model.pt` 上傳到同一個資料夾。\n"
            "3. 執行中請保持這個分頁開著、電腦不要睡眠。斷線了就再按一次「全部執行」，會從斷掉的地方接著跑。\n"
            "4. 跑完會自動下載 `bible-verse-timing.zip`。")},
        code("!nvidia-smi --query-gpu=name,memory.total --format=csv\n"
             "import torch, torchaudio\n"
             "assert torch.cuda.is_available(), '沒有 GPU：選單「執行階段 → 變更執行階段類型」選 T4 GPU 後再全部執行'\n"
             "assert hasattr(torchaudio.functional, 'forced_align'), f'torchaudio {torchaudio.__version__} 沒有 forced_align'\n"
             "!pip install -q pypinyin \"soundfile>=0.12\""),
        code("from google.colab import drive\ndrive.mount('/content/drive')"),
        # 模型官方下載點（dl.fbaipublicfiles.com）的憑證過期時，改用使用者上傳到雲端硬碟的同一份檔案；
        # 比對 SHA-256，對不上就不用。
        code("import hashlib, shutil\nfrom pathlib import Path\n"
             f"MODEL_SHA256 = '{MMS_FA_MODEL_SHA256}'\n"
             f"src = Path('{DRIVE_DIR}/model.pt')\n"
             "dst = Path.home() / '.cache/torch/hub/checkpoints/model.pt'\n"
             "if not dst.exists() and src.exists():\n"
             "    tmp = dst.with_suffix('.part'); tmp.parent.mkdir(parents=True, exist_ok=True)\n"
             "    shutil.copyfile(src, tmp)\n"
             "    h = hashlib.sha256()\n"
             "    with tmp.open('rb') as f:\n"
             "        for block in iter(lambda: f.read(1 << 24), b''):\n"
             "            h.update(block)\n"
             "    assert h.hexdigest() == MODEL_SHA256, '雲端硬碟上的 model.pt 和預期的不同，請重新上傳'\n"
             "    tmp.replace(dst)\n"
             "print('對齊模型：', '已就緒' if dst.exists() else '沒有預先放好，會從官方網址下載')"),
        code("import base64, json\nfrom pathlib import Path\n"
             f"FILES = json.loads(base64.b64decode(\"{encoded}\").decode(\"utf-8\"))\n"
             "code = Path('/content/code'); code.mkdir(exist_ok=True)\n"
             "for name, text in FILES.items():\n    (code / name).write_text(text, encoding='utf-8')\n"
             "print('已寫入', sorted(FILES))"),
        code(f"!python /content/code/align.py --work /content/work --out {out} --books /content/code/books.json --prefetch 4 {chapters}"),
        code(f"!python /content/code/check.py --work /content/work --out {out} "
             f"--report {out}/check-report.json --review {out}/review.html\n"
             f"!cd {out}/.. && zip -qr /content/bible-verse-timing.zip out\n"
             "from google.colab import files\nfiles.download('/content/bible-verse-timing.zip')"),
    ]
    target.write_text(json.dumps({
        "nbformat": 4, "nbformat_minor": 0,
        "metadata": {"accelerator": "GPU", "colab": {"gpuType": "T4", "provenance": []},
                     "kernelspec": {"name": "python3", "display_name": "Python 3"}},
        "cells": cells,
    }, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", required=True, type=Path, help="產生 run.py 與 kernel-metadata.json 的資料夾")
    parser.add_argument("--kernel-id", help="<Kaggle 帳號>/<slug>")
    parser.add_argument("--colab", type=Path, help="改產生 Google Colab 用的 .ipynb 到這個路徑")
    parser.add_argument("--title", default="bible verse timing")
    parser.add_argument("--chapters", nargs="*", help="書卷編號:章")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if bool(args.all) == bool(args.chapters):
        raise SystemExit("--all 和 --chapters 二選一")
    if bool(args.kernel_id) == bool(args.colab):
        raise SystemExit("--kernel-id（Kaggle）和 --colab 二選一")

    encoded = bundle_files(args.dir)
    chapter_args = ["--all"] if args.all else ["--chapters", *args.chapters]
    if args.colab:
        write_colab_notebook(args.colab, encoded, chapter_args)
        print(f"已產生 {args.colab}")
        return 0
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
