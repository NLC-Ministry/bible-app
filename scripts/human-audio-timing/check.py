"""檢查 align.py 的逐節時間表（#637），並產生人工抽聽頁。

自動檢查（不用聽）：
  1. 開口點：朗讀者念完一節通常會停一下。對到的開口點（±ONSET_SLACK 秒）前面要安靜、
     後面要馬上有聲音（差 DIP_DB 以上）；沒有就列為「可疑」。
  2. 語速：每節的「音節數／秒」和全章中位數差太多（< 0.5 倍或 > 2 倍）列為「可疑」。
  3. 分數：對齊分數低於 LOW_SCORE 列為「可疑」。

用法：
  <venv>/python scripts/human-audio-timing/check.py --work <資料夾> [--review]
--review 會在 <work>/review.html 產生抽聽頁：點一節就從那一節的時間開始播。
"""

from __future__ import annotations

import argparse
import html
import json
import statistics
import sys
from pathlib import Path

import numpy as np
import soundfile

PAUSE_MS = 200
DIP_DB = 10
# 自動檢查容許的誤差（秒）；比 issue 的 ±0.5 秒門檻嚴。
ONSET_SLACK = 0.2
LOW_SCORE = 0.35
WINDOW_MS = 20


def frame_rms_db(path: Path):
    data, rate = soundfile.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    # 11,025 Hz 的 20 ms 是 220.5 個取樣；hop 取整數會讓時間軸一路漂（詩 119 二十分鐘差 2.7 秒），
    # 所以每個 frame 的起點用浮點數算再取整，不累積誤差。
    hop = rate * WINDOW_MS / 1000
    width = int(hop)
    frames = int((len(mono) - width) / hop) + 1
    starts = (np.arange(frames) * hop).astype(np.int64)
    windows = mono[starts[:, None] + np.arange(width)[None, :]]
    rms = np.sqrt(np.mean(windows ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms)


def has_onset(db, start_s: float) -> bool:
    """對到的開口點前面安靜、後面馬上有聲音：開口前 PAUSE_MS 的音量比開口後 0.4 秒低 DIP_DB 以上。

    跟前後文比、不跟整章比，不同年份錄音的底噪（8–11 kHz 的早期錄音約 -38 dB）才不會影響判斷。
    允許 ONSET_SLACK 秒的誤差：開口點前後各找一次，取最好的。
    """
    per_s = 1000 / WINDOW_MS
    need = max(1, int(PAUSE_MS / WINDOW_MS))
    best = -1e9
    for shift in np.arange(-ONSET_SLACK, ONSET_SLACK + 1e-9, WINDOW_MS / 1000):
        i = int((start_s + shift) * per_s)
        before = db[max(0, i - need):i]
        after = db[i:i + int(0.4 * per_s)]
        if len(before) == 0 or len(after) == 0:
            continue
        best = max(best, float(np.percentile(after, 80)) - float(np.median(before)))
    return best >= DIP_DB


def check_chapter(data: dict, audio: Path) -> dict:
    db = frame_rms_db(audio)
    diag = {d["verse"]: d for d in data.get("diagnostics", [])}
    rates = [d["syllables"] / max(0.1, d["speechEnd"] - d["speechStart"]) for d in diag.values()]
    median_rate = statistics.median(rates) if rates else 0
    suspects = []
    for num, start, score in data["verses"]:
        d = diag.get(num)
        reasons = []
        if start is None or d is None:
            reasons.append("沒對到")
        else:
            if not has_onset(db, d["speechStart"]):
                reasons.append("開口點不在停頓後")
            rate = d["syllables"] / max(0.1, d["speechEnd"] - d["speechStart"])
            if median_rate and not 0.5 * median_rate <= rate <= 2 * median_rate:
                reasons.append(f"語速 {rate:.1f}（中位數 {median_rate:.1f}）")
            if score < LOW_SCORE:
                reasons.append(f"分數 {score:.2f}")
        if reasons:
            suspects.append((num, reasons))
    return {"verses": len(data["verses"]), "suspects": suspects, "medianRate": median_rate}


def write_review(work: Path, items: list[tuple[dict, Path, dict]]) -> Path:
    parts = [
        "<!doctype html><meta charset='utf-8'><title>逐節時間抽聽</title>",
        "<style>body{font:16px/1.6 system-ui;margin:16px;max-width:860px}"
        "button{margin:2px;padding:4px 8px}.bad{background:#fde2e2}h2{margin-top:28px}</style>",
        "<p>點節數就從那一節的時間開始播。紅底＝自動檢查覺得可疑的節。聽聽看：開頭是不是剛好是那一節的第一個字（±0.5 秒）。</p>",
    ]
    for data, audio, report in items:
        bad = {n for n, _ in report["suspects"]}
        key = f"a{data['book']}_{data['chapter']}"
        parts.append(f"<h2>{data['book']}:{data['chapter']}（{data['duration']:.0f} 秒，章首開場到 {data.get('introEnd')} 秒）</h2>")
        parts.append(f"<audio id='{key}' controls preload='none' src='{html.escape(audio.as_uri())}'></audio><div>")
        for num, start, score in data["verses"]:
            if start is None:
                continue
            cls = " class='bad'" if num in bad else ""
            parts.append(
                f"<button{cls} title='{start}s，分數 {score}' onclick=\"var a=document.getElementById('{key}');"
                f"a.currentTime={start};a.play()\">{num}</button>"
            )
        parts.append("</div>")
    target = work / "review.html"
    target.write_text("".join(parts), encoding="utf-8")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--review", action="store_true")
    args = parser.parse_args()
    work = args.work.resolve()
    total = flagged = 0
    items = []
    for path in sorted((work / "out").glob("*.json"), key=lambda p: tuple(int(x) for x in p.stem.split("_"))):
        data = json.loads(path.read_text(encoding="utf-8"))
        audio = work / "audio" / f"{data['book']}_{data['chapter']:03d}.mp3"
        report = check_chapter(data, audio)
        total += report["verses"]
        flagged += len(report["suspects"])
        items.append((data, audio, report))
        detail = "；".join(f"{n}節 {'、'.join(r)}" for n, r in report["suspects"][:8])
        more = f"…等 {len(report['suspects'])} 節" if len(report["suspects"]) > 8 else ""
        print(f"{data['book']}:{data['chapter']}  {report['verses']} 節，可疑 {len(report['suspects'])}  {detail}{more}")
    print(f"合計 {total} 節，可疑 {flagged}（{flagged / max(1, total):.1%}）")
    if args.review:
        print("抽聽頁：", write_review(work, items))
    return 0


if __name__ == "__main__":
    sys.exit(main())
