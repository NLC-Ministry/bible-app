import { describe, it, expect, beforeEach } from 'vitest';
import {
  synthesizeSpeechBlock,
  clearTTSCache,
  getTTSCacheSize,
  computeHash,
  DEFAULT_TAIWAN_VOICE,
  TAIWAN_MALE_VOICE,
  MAX_TTS_TEXT_LENGTH
} from '../lib/blocks/tts-service-block';

describe('Taiwan Edge TTS Service Block (語音朗讀 API 積木測試)', () => {
  beforeEach(() => {
    clearTTSCache();
  });

  it('應成功為繁體中文經文產生語音結果與 Hash 雜湊碼', async () => {
    const text = '神愛世人，甚至將祂的獨生子賜給他們。';
    const result = await synthesizeSpeechBlock({ text });

    expect(result).toBeDefined();
    expect(result.cacheHit).toBe(false);
    expect(result.voice).toBe(DEFAULT_TAIWAN_VOICE);
    expect(result.hash).toBeTruthy();
    expect(result.audioUrl).toContain('data:audio/mp3');
    expect(result.textLength).toBe(text.length);
  });

  it('帶入相同文字與語音時，第二次調用應成功命中快取 (Cache Hit)', async () => {
    const text = '耶和華是我的牧者，我必不致缺乏。';

    // 第一次請求 (快取未命中)
    const result1 = await synthesizeSpeechBlock({ text });
    expect(result1.cacheHit).toBe(false);
    expect(getTTSCacheSize()).toBe(1);

    // 第二次帶入相同文字請求 (應命中快取)
    const result2 = await synthesizeSpeechBlock({ text });
    expect(result2.cacheHit).toBe(true);
    expect(result2.hash).toBe(result1.hash);
    expect(result2.audioUrl).toBe(result1.audioUrl);
    expect(getTTSCacheSize()).toBe(1);
  });

  it('文字超過 1000 字時，應觸發安全性檢查並拋出長度限制異常', async () => {
    const longText = '聖經'.repeat(505); // 1010 字
    expect(longText.length).toBeGreaterThan(MAX_TTS_TEXT_LENGTH);

    await expect(synthesizeSpeechBlock({ text: longText })).rejects.toThrow(
      `朗讀文字長度超出安全限制 (最大 ${MAX_TTS_TEXT_LENGTH} 字`
    );
  });

  it('空字串或純空白應拋出無效文字錯誤', async () => {
    await expect(synthesizeSpeechBlock({ text: '   ' })).rejects.toThrow('朗讀文字不能為空。');
  });

  it('切換台灣男聲 (YunJhe) 時，應獨立計算快取，不與台灣女聲 (HsiaoChen) 混淆', async () => {
    const text = '主是我的力量，我的盾牌。';

    const femaleResult = await synthesizeSpeechBlock({
      text,
      voice: DEFAULT_TAIWAN_VOICE
    });

    const maleResult = await synthesizeSpeechBlock({
      text,
      voice: TAIWAN_MALE_VOICE
    });

    expect(femaleResult.voice).toBe(DEFAULT_TAIWAN_VOICE);
    expect(maleResult.voice).toBe(TAIWAN_MALE_VOICE);
    expect(femaleResult.hash).not.toBe(maleResult.hash);
    expect(getTTSCacheSize()).toBe(2);
  });

  it('clearTTSCache 應能安全清空快取', async () => {
    await synthesizeSpeechBlock({ text: '測試經文 A' });
    await synthesizeSpeechBlock({ text: '測試經文 B' });
    expect(getTTSCacheSize()).toBe(2);

    clearTTSCache();
    expect(getTTSCacheSize()).toBe(0);
  });
});
