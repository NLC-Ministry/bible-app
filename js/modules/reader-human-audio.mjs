// 真人朗讀（#636）：播信望愛站的和合本華語朗讀音檔，和裝置語音（speechSynthesis）並存。
// 一章一個 mp3、沒有逐節時間，所以真人朗讀不標示念到哪一節（逐節同步見 #637）。
// 音檔在 media.fhl.net、沒有 CORS，只能交給 <audio> 串流；不進 Service Worker 快取。

export const SPEECH_MODES = Object.freeze({ DEVICE: "device", HUMAN: "human" });

// 信望愛的和合本朗讀念的是官話和合本；新標點和合本是同一份經文重新標點，也播這份。
export const HUMAN_AUDIO_VERSIONS = Object.freeze(["CUNP", "CUV"]);

const FHL_AUDIO_INFO_ENDPOINT = "https://bible.fhl.net/json/au.php";
const FHL_AUDIO_HOST_PREFIX = "https://media.fhl.net/";

export const HUMAN_AUDIO_COPY = Object.freeze({
  attribution: "朗讀：信望愛站（FDL 授權）",
  modeNote: "朗讀和合本，需要網路。新標點和合本的少數人名用字與朗讀不同；修訂版、當代譯本與英文版本會改用裝置語音。",
  started: "開始真人朗讀",
  startsAtChapterStart: "真人朗讀會從章首開始，可拖曳進度條調整位置",
  paused: "朗讀已暫停，再按一次會從暫停的地方繼續",
  unavailable: "真人朗讀需要網路，可改用裝置語音",
  fallbackNotice: "此版本沒有真人朗讀，改用裝置語音",
  switchToCuv: "改看和合本聽真人朗讀",
  mediaArtist: "和合本朗讀",
  mediaAlbum: "信望愛站"
});

export function normalizeSpeechMode(mode) {
  return mode === SPEECH_MODES.HUMAN ? SPEECH_MODES.HUMAN : SPEECH_MODES.DEVICE;
}

export function supportsHumanAudio(version) {
  return HUMAN_AUDIO_VERSIONS.includes(String(version || "CUNP").toUpperCase());
}

// fallback＝使用者選了真人朗讀，但目前版本沒有音檔，改用裝置語音。
export function resolveReaderSpeechSource({ mode, version } = {}) {
  if (normalizeSpeechMode(mode) !== SPEECH_MODES.HUMAN) return { source: SPEECH_MODES.DEVICE, fallback: false };
  if (supportsHumanAudio(version)) return { source: SPEECH_MODES.HUMAN, fallback: false };
  return { source: SPEECH_MODES.DEVICE, fallback: true };
}

export function buildFhlAudioInfoUrl(bookId, chapter) {
  return `${FHL_AUDIO_INFO_ENDPOINT}?version=0&bid=${Number(bookId)}&chap=${Number(chapter)}&gb=0`;
}

export function readFhlAudioUrl(payload) {
  if (!payload || payload.status !== "success") return null;
  const url = typeof payload.mp3 === "string" ? payload.mp3 : "";
  return url.startsWith(FHL_AUDIO_HOST_PREFIX) ? url : null;
}

export function formatAudioClock(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "--:--";
  const whole = Math.floor(value);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function formatHumanAudioTimelineLabel({ status = "speaking", currentTime = 0, duration = NaN } = {}) {
  if (status === "loading") return "載入中…";
  const prefix = status === "paused" ? "已暫停・" : status === "completed" ? "已完成・" : "朗讀中・";
  return `${prefix}${formatAudioClock(currentTime)}／${formatAudioClock(duration)}`;
}

export function clampHumanAudioRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(2, Math.max(0.5, value));
}

// 一個讀經頁共用一個 <audio>：接下一章時沿用同一個元素換 src，iOS 鎖定畫面時才能接著播。
export function createHumanAudioPlayer({
  createAudio = () => new Audio(),
  fetchImpl = (...args) => fetch(...args),
  onTimeUpdate = () => {},
  onEnded = () => {},
  onError = () => {}
} = {}) {
  let audio = null;
  let loadedKey = null;
  // start()／stop() 都會換代；還在等網址的 start() 發現換代了就不播。
  let generation = 0;
  const urlCache = new Map();

  const keyOf = (bookId, chapter) => `${Number(bookId)}:${Number(chapter)}`;

  function getAudio() {
    if (audio) return audio;
    audio = createAudio();
    audio.preload = "auto";
    audio.addEventListener("timeupdate", () => { if (loadedKey) onTimeUpdate(); });
    audio.addEventListener("loadedmetadata", () => { if (loadedKey) onTimeUpdate(); });
    audio.addEventListener("ended", () => { if (loadedKey) onEnded(); });
    // stop() 拿掉 src 時，有些瀏覽器會丟 error 事件；那時 loadedKey 已清空，不算播放失敗。
    audio.addEventListener("error", () => { if (loadedKey) onError(); });
    return audio;
  }

  function resolveUrl(bookId, chapter) {
    const key = keyOf(bookId, chapter);
    if (!urlCache.has(key)) {
      const pending = Promise.resolve()
        .then(() => fetchImpl(buildFhlAudioInfoUrl(bookId, chapter)))
        .then(response => {
          if (!response?.ok) throw new Error(`FHL audio info HTTP ${response?.status}`);
          return response.json();
        })
        .then(payload => {
          const url = readFhlAudioUrl(payload);
          if (!url) throw new Error("FHL audio info has no usable mp3");
          return url;
        });
      // 失敗不留快取，下次按朗讀會重問。
      pending.catch(() => urlCache.delete(key));
      urlCache.set(key, pending);
    }
    return urlCache.get(key);
  }

  return {
    prefetch(bookId, chapter) {
      resolveUrl(bookId, chapter).catch(() => {});
    },
    async start({ bookId, chapter, rate }) {
      const token = ++generation;
      const url = await resolveUrl(bookId, chapter);
      if (token !== generation) return false;
      const el = getAudio();
      loadedKey = keyOf(bookId, chapter);
      el.src = url;
      el.playbackRate = clampHumanAudioRate(rate);
      await el.play();
      return token === generation;
    },
    async resume({ rate }) {
      if (!audio || !loadedKey) return false;
      audio.playbackRate = clampHumanAudioRate(rate);
      await audio.play();
      return true;
    },
    pause() {
      audio?.pause();
    },
    stop() {
      generation++;
      loadedKey = null;
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
    seek(seconds) {
      if (!audio || !loadedKey) return;
      const duration = Number(audio.duration);
      const target = Math.max(0, Number(seconds) || 0);
      audio.currentTime = Number.isFinite(duration) ? Math.min(target, duration) : target;
    },
    isLoaded(bookId, chapter) {
      return loadedKey === keyOf(bookId, chapter);
    },
    getPosition() {
      return { currentTime: Number(audio?.currentTime) || 0, duration: Number(audio?.duration) };
    }
  };
}
