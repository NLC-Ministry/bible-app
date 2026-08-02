import React, { useState, useEffect, useRef } from 'react';
import {
  synthesizeSpeechBlock,
  DEFAULT_TAIWAN_VOICE,
  TAIWAN_MALE_VOICE,
  TTSResult
} from '../../lib/blocks/tts-service-block';

export interface TTSPlayerProps {
  text: string;
  defaultVoice?: string;
  autoPlay?: boolean;
  className?: string;
  onEnded?: () => void;
  onError?: (error: Error) => void;
}

export const TTSPlayer: React.FC<TTSPlayerProps> = ({
  text,
  defaultVoice = DEFAULT_TAIWAN_VOICE,
  autoPlay = false,
  className = '',
  onEnded,
  onError
}) => {
  const [voice, setVoice] = useState<string>(defaultVoice);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [ttsResult, setTtsResult] = useState<TTSResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 1. 初始化音訊物件
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (audio.duration) {
        setCurrentTime(audio.currentTime);
        setDuration(audio.duration);
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(100);
      if (onEnded) onEnded();
    };

    const handleAudioError = (_e: Event) => {
      setIsPlaying(false);
      setIsLoading(false);
      const err = new Error('音訊載入或播放失敗。');
      setErrorMessage(err.message);
      if (onError) onError(err);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleAudioError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleAudioError);
      audio.pause();
    };
  }, [onEnded, onError]);

  // 2. 觸發語音合成積木
  const handleLoadAndTogglePlay = async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    if (ttsResult && audioRef.current && audioRef.current.src === ttsResult.audioUrl) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.warn('Playback interrupted:', err);
      }
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);

      // 調用 Edge TTS API 積木
      const result = await synthesizeSpeechBlock({
        text,
        voice
      });

      setTtsResult(result);

      if (audioRef.current) {
        audioRef.current.src = result.audioUrl;
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setErrorMessage(error.message);
      if (onError) onError(error);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. 拖動進度條
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetProgress = parseFloat(e.target.value);
    if (audioRef.current && duration > 0) {
      const targetTime = (targetProgress / 100) * duration;
      audioRef.current.currentTime = targetTime;
      setProgress(targetProgress);
      setCurrentTime(targetTime);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className={`tts-player-card ${className}`} style={cardStyle}>
      {/* 頂部控制器與 Voice 切換 */}
      <div style={headerStyle}>
        <div style={voiceSelectorStyle}>
          <span style={labelStyle}>🇹🇼 台灣語音:</span>
          <button
            type="button"
            style={voice === DEFAULT_TAIWAN_VOICE ? activeVoiceBtnStyle : voiceBtnStyle}
            onClick={() => setVoice(DEFAULT_TAIWAN_VOICE)}
          >
            曉臻 (女聲)
          </button>
          <button
            type="button"
            style={voice === TAIWAN_MALE_VOICE ? activeVoiceBtnStyle : voiceBtnStyle}
            onClick={() => setVoice(TAIWAN_MALE_VOICE)}
          >
            雲哲 (男聲)
          </button>
        </div>

        {ttsResult?.cacheHit && (
          <span style={cacheBadgeStyle} title="命中 SHA-256 快取，未重複消耗 API">
            ⚡ 快取載入 (Zero-waste)
          </span>
        )}
      </div>

      {/* 錯誤提示 */}
      {errorMessage && (
        <div style={errorStyle}>
          ⚠️ {errorMessage}
        </div>
      )}

      {/* 播放 / 暫停與進度條 */}
      <div style={controlsRowStyle}>
        <button
          type="button"
          onClick={handleLoadAndTogglePlay}
          disabled={isLoading}
          style={playBtnStyle}
        >
          {isLoading ? '⌛ 載入中...' : isPlaying ? '⏸️ 暫停' : '▶️ 播放朗讀'}
        </button>

        <div style={progressContainerStyle}>
          <input
            type="range"
            min="0"
            max="100"
            value={progress}
            onChange={handleSeek}
            disabled={!ttsResult}
            style={rangeInputStyle}
          />
          <div style={timeDisplayStyle}>
            <span>{formatTime(currentTime)}</span>
            <span>/</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// 簡約inline樣式
const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card, #ffffff)',
  border: '1px solid var(--border-card, #e2e8f0)',
  borderRadius: '16px',
  padding: '1.25rem',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  maxWidth: '480px'
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
};

const voiceSelectorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.85rem'
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--text-secondary, #64748b)'
};

const voiceBtnStyle: React.CSSProperties = {
  padding: '0.25rem 0.6rem',
  borderRadius: '12px',
  border: '1px solid #cbd5e1',
  background: 'transparent',
  fontSize: '0.8rem',
  cursor: 'pointer',
  transition: 'all 0.2s'
};

const activeVoiceBtnStyle: React.CSSProperties = {
  ...voiceBtnStyle,
  background: 'var(--color-primary, #1877f2)',
  color: '#ffffff',
  borderColor: 'var(--color-primary, #1877f2)',
  fontWeight: 600
};

const cacheBadgeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#16a34a',
  background: 'rgba(22, 163, 74, 0.1)',
  padding: '0.2rem 0.5rem',
  borderRadius: '10px',
  fontWeight: 500
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  background: '#fef2f2',
  padding: '0.5rem 0.75rem',
  borderRadius: '8px',
  fontSize: '0.85rem'
};

const controlsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem'
};

const playBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  borderRadius: '24px',
  border: 'none',
  background: 'var(--color-primary, #1877f2)',
  color: '#ffffff',
  fontWeight: 600,
  fontSize: '0.9rem',
  cursor: 'pointer',
  minWidth: '110px'
};

const progressContainerStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem'
};

const rangeInputStyle: React.CSSProperties = {
  width: '100%',
  cursor: 'pointer'
};

const timeDisplayStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  fontSize: '0.75rem',
  color: 'var(--text-muted, #94a3b8)',
  justifyContent: 'flex-end'
};
