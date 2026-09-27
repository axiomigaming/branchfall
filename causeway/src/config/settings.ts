import { detectQuality, type QualityLevel } from './quality';

export interface Settings {
  master: number; // 0..1
  music: number;
  sfx: number;
  muted: boolean;
  quality: QualityLevel;
  motion: 'full' | 'reduced';
  cameraShake: boolean;
  autoQuality: boolean;
  /** Vibration on phones that support it. */
  haptics: boolean;
}

const KEY = 'causeway.settings.v1';

export function defaultSettings(): Settings {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    master: 0.8,
    music: 0.6,
    sfx: 0.85,
    muted: false,
    quality: detectQuality(),
    motion: reduced ? 'reduced' : 'full',
    cameraShake: !reduced,
    autoQuality: true,
    haptics: !reduced,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    return { ...d, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit */
  }
}
