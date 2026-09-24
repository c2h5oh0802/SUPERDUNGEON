// 設定：優先存在 localStorage；被封鎖或不可用時退回本次工作階段（不會崩潰）。

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  masterVolume: number;
  sfxVolume: number;
  pixelRatio: number;
  reducedMotion: boolean;
  seenIntro: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  fov: 75,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  pixelRatio: 1.5,
  reducedMotion: false,
  seenIntro: false,
};

const KEY = 'superdungeon.settings.v1';

export class SettingsStore {
  value: Settings = { ...DEFAULT_SETTINGS };
  persistent = true;

  load(): Settings {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        this.value = sanitize({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch {
      this.persistent = false;
    }
    return this.value;
  }

  save(): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.value));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
  }

  update(patch: Partial<Settings>): Settings {
    this.value = sanitize({ ...this.value, ...patch });
    this.save();
    return this.value;
  }
}

function num(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
}

function sanitize(s: Settings): Settings {
  return {
    sensitivity: num(s.sensitivity, 0.2, 3, 1),
    invertY: !!s.invertY,
    fov: num(s.fov, 60, 100, 75),
    masterVolume: num(s.masterVolume, 0, 1, 0.8),
    sfxVolume: num(s.sfxVolume, 0, 1, 0.9),
    pixelRatio: num(s.pixelRatio, 0.75, 2, 1.5),
    reducedMotion: !!s.reducedMotion,
    seenIntro: !!s.seenIntro,
  };
}
