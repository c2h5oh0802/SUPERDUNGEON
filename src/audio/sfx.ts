import type { GameEvent } from '../sim/types';

// 程序音效（WebAudio）：不需要外部音檔。單一 AudioContext 跨局重用，限制同時發聲數，
// 有主音量、音效音量與限制器；關閉音訊不影響遊戲判定。

type Pan = { x: number; z: number } | null;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private lowpass!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private voices = 0;
  private listener = { x: 0, z: 0, yaw: 0 };
  masterVolume = 0.8;
  sfxVolume = 0.9;
  enabled = true;

  /** 在使用者手勢中呼叫。 */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 8;
        comp.ratio.value = 6;
        this.master = this.ctx.createGain();
        this.sfx = this.ctx.createGain();
        this.lowpass = this.ctx.createBiquadFilter();
        this.lowpass.type = 'lowpass';
        this.lowpass.frequency.value = 20000;
        this.sfx.connect(this.lowpass);
        this.lowpass.connect(this.master);
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  get active(): boolean {
    return !!this.ctx;
  }

  setVolumes(master: number, sfx: number): void {
    this.masterVolume = master;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.masterVolume * 0.7;
    this.sfx.gain.value = this.sfxVolume;
  }

  /** 世界變慢時整體聲音稍微悶住。 */
  setSlow(k: number): void {
    if (!this.ctx) return;
    const f = 20000 - 16500 * Math.min(1, Math.max(0, k));
    this.lowpass.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
  }

  setListener(x: number, z: number, yaw: number): void {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private out(pos: Pan, vol: number): { node: AudioNode; gain: GainNode } | null {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || this.voices > 28) return null;
    const g = ctx.createGain();
    let v = vol;
    let node: AudioNode = g;
    if (pos) {
      const dx = pos.x - this.listener.x;
      const dz = pos.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      v *= 1 / (1 + d / 7);
      const ang = Math.atan2(-dx, -dz) - this.listener.yaw;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.85, Math.min(0.85, -Math.sin(ang)));
      g.connect(pan);
      pan.connect(this.sfx);
      node = g;
    } else g.connect(this.sfx);
    g.gain.value = v;
    return { node, gain: g };
  }

  private track(src: AudioScheduledSourceNode, stopAt: number, ...nodes: AudioNode[]): void {
    this.voices++;
    src.onended = () => {
      this.voices--;
      for (const n of nodes) n.disconnect();
      src.disconnect();
    };
    src.stop(stopAt);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, pos: Pan = null, delay = 0): void {
    const ctx = this.ctx;
    const o = this.out(pos, vol);
    if (!ctx || !o) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(o.node);
    osc.start(t);
    this.track(osc, t + dur + 0.05, env, o.gain);
  }

  private noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1, pos: Pan = null, delay = 0): void {
    const ctx = this.ctx;
    const o = this.out(pos, vol);
    if (!ctx || !o) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(env);
    env.connect(o.node);
    src.start(t, Math.random() * 0.5);
    this.track(src, t + dur + 0.05, filt, env, o.gain);
  }

  ui(kind: 'click' | 'open' | 'deny'): void {
    if (kind === 'click') this.tone('triangle', 880, 660, 0.06, 0.12);
    else if (kind === 'open') this.tone('sine', 520, 780, 0.12, 0.12);
    else this.tone('square', 220, 180, 0.1, 0.08);
  }

  onEvents(events: GameEvent[]): void {
    if (!this.ctx) return;
    let hurtPlayed = false;
    for (const e of events) {
      const pos: Pan = e.x !== undefined && e.z !== undefined ? { x: e.x, z: e.z } : null;
      switch (e.type) {
        case 'swing':
          this.noise(0.16, 0.35, 'bandpass', 700, 2600, 2);
          break;
        case 'fire':
          this.noise(0.09, 0.45, 'lowpass', 900, 200, 1);
          this.tone('triangle', 240, 150, 0.22, 0.25);
          break;
        case 'throw':
          this.noise(0.12, 0.25, 'bandpass', 900, 1800, 2);
          break;
        case 'dryFire':
          this.tone('square', 1800, 1500, 0.03, 0.12);
          break;
        case 'drink':
          this.noise(0.5, 0.12, 'bandpass', 500, 900, 4);
          break;
        case 'hitEnemy':
          this.tone('sine', e.head ? 320 : 190, 70, 0.18, 0.5, pos);
          this.noise(0.06, 0.35, 'highpass', 2500, 1500, 1, pos);
          if (e.sneak) this.tone('triangle', 660, 990, 0.18, 0.18, pos, 0.02);
          break;
        case 'shield':
          for (const f of [910, 1370, 2130]) this.tone('triangle', f, f * 0.97, 0.35, 0.14, pos);
          break;
        case 'hitWall':
          this.noise(0.06, 0.2, 'highpass', 3000, 1800, 1, pos);
          break;
        case 'enemyDeath':
          this.tone('sine', 150, 50, 0.45, 0.35, pos);
          break;
        case 'playerHurt':
          if (hurtPlayed) break;
          hurtPlayed = true;
          this.tone('sine', 120, 45, 0.3, 0.6);
          this.noise(0.22, 0.35, 'lowpass', 1200, 300, 1);
          break;
        case 'door':
          this.noise(0.45, 0.35, 'lowpass', 260, 140, 1, pos);
          this.tone('sawtooth', 95, 75, 0.4, 0.05, pos);
          break;
        case 'doorBlocked':
        case 'barred':
          this.tone('sine', 160, 120, 0.12, 0.3, pos);
          break;
        case 'unbar':
          this.noise(0.3, 0.3, 'bandpass', 400, 250, 2, pos);
          break;
        case 'bottleBreak':
          for (let k = 0; k < 5; k++) this.tone('sine', 2200 + Math.random() * 2600, 1800, 0.18, 0.08, pos, k * 0.012);
          this.noise(0.14, 0.3, 'highpass', 5000, 3000, 1, pos);
          break;
        case 'smoke':
          this.noise(0.9, 0.18, 'lowpass', 1800, 300, 1, pos);
          break;
        case 'pickup':
          this.tone('triangle', 660, 660, 0.08, 0.14);
          this.tone('triangle', 990, 990, 0.1, 0.12, null, 0.06);
          break;
        case 'chest':
          this.noise(0.35, 0.2, 'bandpass', 300, 600, 3, pos);
          this.tone('sine', 784, 784, 0.25, 0.1, null, 0.2);
          break;
        case 'rune':
          [523, 659, 784, 1046].forEach((f, k) => this.tone('sine', f, f, 0.5, 0.12, null, k * 0.08));
          break;
        case 'resupply':
          [523, 784].forEach((f, k) => this.tone('triangle', f, f, 0.2, 0.12, null, k * 0.08));
          break;
        case 'heart':
          this.tone('sine', 880, 880, 1.2, 0.12);
          this.tone('sine', 1320, 1320, 1.0, 0.06, null, 0.05);
          break;
        case 'wake':
          for (const [f, v] of [
            [98, 0.4],
            [196, 0.2],
            [262, 0.12],
            [415, 0.08],
          ] as const)
            this.tone('sine', f, f * 0.99, 3.0, v, null, 0.25);
          break;
        case 'win':
          [392, 494, 587, 784].forEach((f, k) => this.tone('triangle', f, f, 0.8, 0.14, null, k * 0.1));
          break;
        case 'death':
          this.tone('sawtooth', 220, 55, 1.2, 0.12);
          break;
        case 'alert':
          this.tone('square', 740, 980, 0.1, 0.12, pos);
          break;
        case 'suspicious':
          this.tone('sine', 420, 540, 0.16, 0.1, pos);
          break;
        case 'wakeUp':
          this.tone('sine', 300, 420, 0.2, 0.08, pos);
          break;
        case 'enemyWindup':
          if (e.kind === 'guard') this.noise(0.5, 0.22, 'bandpass', 1800, 4200, 6, pos);
          else if (e.kind === 'archer') this.tone('sawtooth', 140, 260, 0.8, 0.07, pos);
          else {
            this.tone('sawtooth', 70, 55, 0.8, 0.14, pos);
            this.noise(0.8, 0.12, 'lowpass', 300, 150, 1, pos);
          }
          break;
        case 'enemyStrike':
          this.noise(0.14, 0.3, 'bandpass', 1500, 500, 2, pos);
          break;
        case 'enemyFire':
          this.noise(0.08, 0.3, 'lowpass', 700, 200, 1, pos);
          this.tone('triangle', 200, 120, 0.18, 0.18, pos);
          break;
        case 'stun':
          this.tone('sine', 90, 40, 0.5, 0.6, pos);
          this.noise(0.3, 0.4, 'lowpass', 800, 200, 1, pos);
          break;
        case 'trapArm':
          this.tone('square', 1300, 1250, 0.04, 0.14, pos);
          break;
        case 'trapSpike':
          this.noise(0.18, 0.35, 'highpass', 4000, 2500, 2, pos);
          break;
        default:
      }
    }
  }
}
