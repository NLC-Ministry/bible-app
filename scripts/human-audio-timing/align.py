"""真人朗讀逐節時間表（#637）：離線把信望愛和合本朗讀 mp3 對齊到每一節。

做法：MMS 強制對齊（torchaudio MMS_FA）。經文轉成無聲調拼音後逐字對齊，
章首的報章名與章末多出的聲音交給 star token（`*`）吸收，不算進任何一節。

不放進 App 執行；音檔、模型與中間檔都放在 --work 指定的資料夾（不要放進 repo）。

用法（Python 3.11+）：
  python -m venv <venv>
  <venv>/python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
  <venv>/python -m pip install soundfile pypinyin numpy
  <venv>/python scripts/human-audio-timing/align.py --work <資料夾> --chapters 19:117 1:1
  <venv>/python scripts/human-audio-timing/align.py --work <資料夾> --all

每章輸出 <work>/out/<bid>_<chap>.json：
  {"book": 19, "chapter": 117, "duration": 24.3,
   "verses": [[1, 3.12, 0.81], ...]}   # [節, 開始秒數, 對齊分數 0–1]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BOOKS_FILE = REPO_ROOT / "js" / "data" / "bible_data.js"

AUDIO_INFO = "https://bible.fhl.net/json/au.php?version=0&bid={bid}&chap={chap}&gb=0"
TEXT_API = "https://bible.fhl.net/json/qb.php?chineses={abbrev}&chap={chap}&version=unv&gb=0"
AUDIO_HOST = "https://media.fhl.net/"
USER_AGENT = "bible-speed-reading-verse-timing/1.0"

SAMPLE_RATE = 16000
# wav2vec2 一個 frame＝320 個取樣（20 ms）。
FRAME_SAMPLES = 320
# 長章節分段算 emission：每段 CHUNK 秒，前後各多看 CONTEXT 秒，只取中間。
CHUNK_SECONDS = 20
CONTEXT_SECONDS = 2
# 節的開始點往前留一點，避免切到第一個字的聲母；最多退到上一節結束的位置。
LEAD_SECONDS = 0.25

HAN_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
PAREN_RE = re.compile(r"（[^（）]*）|\([^()]*\)")
# 和合本括號有兩種：譯註小字（「或譯…」「原文是…」「有古卷…」「在創世記十章三節是利法」）
# 和本來就是經文的括號（詩篇標題、細拉、約 3:24 整節）。後者照念；前者不確定朗讀者念不念，
# 換成 star token，念了就被吸收、沒念也只佔一個 frame，不會把時間擠到旁邊的字。
TRANSLATOR_NOTE_RE = re.compile(r"或譯|或作|原文|有古卷|下同|^（在.+是|就是.+的意思")


def load_books() -> dict[int, dict]:
    text = BOOKS_FILE.read_text(encoding="utf-8")
    pattern = re.compile(r'\{\s*id:\s*(\d+),\s*name:\s*"([^"]+)",\s*abbrev:\s*"([^"]+)",[^}]*?chapters:\s*(\d+)')
    books = {int(m[1]): {"id": int(m[1]), "name": m[2], "abbrev": m[3], "chapters": int(m[4])} for m in pattern.finditer(text)}
    if len(books) != 66:
        raise SystemExit(f"讀到 {len(books)} 卷書，預期 66 卷：{BOOKS_FILE}")
    return books


def http_get(url: str, retries: int = 3) -> bytes:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except Exception as error:  # noqa: BLE001 — 網路錯誤一律重試
            last = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def cached_json(path: Path, url: str) -> dict:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(http_get(url))
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_verses(work: Path, book: dict, chap: int) -> list[tuple[int, str]]:
    url = TEXT_API.format(abbrev=urllib.parse.quote(book["abbrev"]), chap=chap)
    payload = cached_json(work / "text" / f"{book['id']}_{chap}.json", url)
    records = payload.get("record") or []
    if payload.get("status") != "success" or not records:
        raise RuntimeError(f"經文 API 沒有 {book['name']} {chap} 章")
    return [(int(r["sec"]), str(r["bible_text"])) for r in records]


def fetch_audio(work: Path, bid: int, chap: int) -> Path:
    target = work / "audio" / f"{bid}_{chap:03d}.mp3"
    if target.exists() and target.stat().st_size > 0:
        return target
    info = cached_json(work / "audio-info" / f"{bid}_{chap}.json", AUDIO_INFO.format(bid=bid, chap=chap))
    url = info.get("mp3") if info.get("status") == "success" else None
    if not isinstance(url, str) or not url.startswith(AUDIO_HOST):
        raise RuntimeError(f"信望愛沒有 {bid}:{chap} 的音檔")
    target.parent.mkdir(parents=True, exist_ok=True)
    data = http_get(url)
    partial = target.with_suffix(".part")
    partial.write_bytes(data)
    partial.replace(target)
    return target


def _syllables(text: str) -> list[str]:
    from pypinyin import Style, lazy_pinyin

    chars = "".join(HAN_RE.findall(text))
    syllables = lazy_pinyin(chars, style=Style.NORMAL, errors="ignore")
    return [s for s in (re.sub(r"[^a-z]", "", s.replace("ü", "v").lower()) for s in syllables) if s]


def romanize_verse(text: str) -> list[str]:
    """一個漢字一個拼音音節（無聲調，ü 寫成 v），標點與非漢字略過；譯註換成 "*"。"""
    words: list[str] = []
    cursor = 0
    for match in PAREN_RE.finditer(text):
        words.extend(_syllables(text[cursor:match.start()]))
        if TRANSLATOR_NOTE_RE.search(match.group(0)):
            if not words or words[-1] != "*":
                words.append("*")
        else:
            words.extend(_syllables(match.group(0)))
        cursor = match.end()
    words.extend(_syllables(text[cursor:]))
    return words


class Aligner:
    def __init__(self) -> None:
        import torch
        import torchaudio

        self.torch = torch
        self.torchaudio = torchaudio
        self.bundle = torchaudio.pipelines.MMS_FA
        self.model = self.bundle.get_model(with_star=True)
        self.model.eval()
        self.dictionary = self.bundle.get_dict(star="*")
        torch.set_num_threads(max(1, torch.get_num_threads()))

    def load_waveform(self, path: Path):
        import soundfile

        data, rate = soundfile.read(str(path), dtype="float32", always_2d=True)
        waveform = self.torch.from_numpy(data.T).mean(dim=0, keepdim=True)
        if rate != SAMPLE_RATE:
            waveform = self.torchaudio.functional.resample(waveform, rate, SAMPLE_RATE)
        return waveform

    def emission(self, waveform):
        """長音檔分段算 emission，接起來後第 k 個 frame 一定對應第 k×20 ms。

        每段的起點（left、start）都是 FRAME_SAMPLES 的倍數，段內第 j 個 frame 就是全域第
        left/FRAME_SAMPLES + j 個 frame。不能用「frame 數／取樣數」的比例去換算：每段會差一個
        frame，20 分鐘的詩 119 會累積到 1 秒以上的漂移。
        """
        torch = self.torch
        total = waveform.size(1)
        chunk = CHUNK_SECONDS * SAMPLE_RATE
        context = CONTEXT_SECONDS * SAMPLE_RATE
        assert chunk % FRAME_SAMPLES == 0 and context % FRAME_SAMPLES == 0
        pieces = []
        with torch.inference_mode():
            for start in range(0, total, chunk):
                end = min(total, start + chunk)
                left = max(0, start - context)
                right = min(total, end + context)
                out, _ = self.model(waveform[:, left:right])
                a = (start - left) // FRAME_SAMPLES
                b = a + -(-(end - start) // FRAME_SAMPLES)
                pieces.append(out[:, a:min(b, out.size(1))])
        emission = torch.cat(pieces, dim=1)
        total_frames = emission.size(1)
        expected = total // FRAME_SAMPLES
        if abs(total_frames - expected) > 2:
            raise RuntimeError(f"emission 有 {total_frames} 個 frame，預期約 {expected}")
        return emission

    def align(self, emission, words: list[str]):
        torch = self.torch
        F = self.torchaudio.functional
        tokens = [self.dictionary[c] for word in words for c in word]
        targets = torch.tensor([tokens], dtype=torch.int32)
        aligned, scores = F.forced_align(emission, targets, blank=0)
        aligned, scores = aligned[0], scores[0].exp()
        spans = F.merge_tokens(aligned, scores)
        out, i = [], 0
        for word in words:
            out.append(spans[i:i + len(word)])
            i += len(word)
        return out


def align_chapter(aligner: Aligner, work: Path, book: dict, chap: int) -> dict:
    verses = fetch_verses(work, book, chap)
    audio = fetch_audio(work, book["id"], chap)
    waveform = aligner.load_waveform(audio)
    duration = waveform.size(1) / SAMPLE_RATE
    emission = aligner.emission(waveform)
    seconds_per_frame = FRAME_SAMPLES / SAMPLE_RATE

    # 前後各一個 star：章首報章名、章末多出的聲音。
    words = ["*"]
    verse_ranges = []
    for num, text in verses:
        syllables = romanize_verse(text)
        verse_ranges.append((num, len(words), len(words) + len(syllables)))
        words.extend(syllables)
    words.append("*")

    word_spans = aligner.align(emission, words)

    result, diagnostics, prev_end = [], [], None
    for num, a, b in verse_ranges:
        spans = [s for w in word_spans[a:b] for s in w]
        if not spans:
            result.append([num, None, 0.0])
            continue
        start = spans[0].start * seconds_per_frame
        end = spans[-1].end * seconds_per_frame
        lead_floor = prev_end if prev_end is not None else 0.0
        begin = max(lead_floor, start - LEAD_SECONDS)
        score = sum(s.score * (s.end - s.start) for s in spans) / max(1, sum(s.end - s.start for s in spans))
        result.append([num, round(begin, 2), round(float(score), 3)])
        diagnostics.append({"verse": num, "speechStart": round(start, 2), "speechEnd": round(end, 2), "syllables": sum(1 for w in words[a:b] if w != "*")})
        prev_end = end

    intro_end = result[0][1] if result and result[0][1] is not None else None
    return {
        "book": book["id"],
        "chapter": chap,
        "duration": round(duration, 2),
        "introEnd": intro_end,
        "verses": result,
        "diagnostics": diagnostics,
    }


def parse_chapters(args, books: dict[int, dict]) -> list[tuple[int, int]]:
    if args.all:
        return [(bid, c) for bid in sorted(books) for c in range(1, books[bid]["chapters"] + 1)]
    pairs = []
    for item in args.chapters or []:
        bid, chap = (int(x) for x in item.split(":"))
        if bid not in books or not 1 <= chap <= books[bid]["chapters"]:
            raise SystemExit(f"沒有這一章：{item}")
        pairs.append((bid, chap))
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work", required=True, type=Path, help="音檔、模型輸出與中間檔的資料夾（不要放進 repo）")
    parser.add_argument("--chapters", nargs="*", help="書卷編號:章，例如 19:117")
    parser.add_argument("--all", action="store_true", help="全部 1,189 章")
    parser.add_argument("--force", action="store_true", help="已有輸出也重算")
    args = parser.parse_args()

    work = args.work.resolve()
    if REPO_ROOT in work.parents or work == REPO_ROOT:
        raise SystemExit("--work 不能放在 repo 裡面")
    books = load_books()
    chapters = parse_chapters(args, books)
    if not chapters:
        raise SystemExit("沒有指定章節：用 --chapters 或 --all")

    aligner = Aligner()
    out_dir = work / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    failures = []
    for index, (bid, chap) in enumerate(chapters, 1):
        target = out_dir / f"{bid}_{chap}.json"
        if target.exists() and not args.force:
            continue
        began = time.time()
        try:
            data = align_chapter(aligner, work, books[bid], chap)
        except Exception as error:  # noqa: BLE001 — 單章失敗不擋其他章，最後列出
            failures.append((bid, chap, str(error)))
            print(f"[{index}/{len(chapters)}] {bid}:{chap} 失敗：{error}", file=sys.stderr, flush=True)
            continue
        target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"[{index}/{len(chapters)}] {bid}:{chap} {data['duration']:.0f}s 音檔，用了 {time.time() - began:.0f}s", flush=True)
    if failures:
        print(f"{len(failures)} 章失敗：", ", ".join(f"{b}:{c}" for b, c, _ in failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
