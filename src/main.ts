import './ui/style.css';
import { Sfx } from './audio/sfx';
import { runeInfo, type RuneId } from './config';
import { clampRealDt } from './core/time';
import { Loop } from './core/loop';
import { normalizeSeed, randomSeed } from './core/rng';
import { installDevApi } from './dev/devapi';
import { generateLevel } from './gen/validate';
import { Input } from './input/input';
import { GameRenderer } from './render/renderer';
import type { FrameInput } from './sim/types';
import { World } from './sim/world';
import { Hud } from './ui/hud';
import { drawMap } from './ui/mapView';
import { SettingsStore } from './ui/settings';

type Mode = 'menu' | 'loading' | 'playing' | 'paused' | 'map' | 'rune' | 'results';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ['screen-menu', 'screen-help', 'screen-settings', 'screen-pause', 'screen-rune', 'screen-map', 'screen-results', 'screen-loading', 'screen-mobile'];

export class App {
  readonly canvas = $<HTMLCanvasElement>('game');
  readonly settings = new SettingsStore();
  readonly sfx = new Sfx();
  readonly hud = new Hud();
  readonly loop = new Loop();
  readonly renderer: GameRenderer;
  readonly input: Input;
  world: World | null = null;
  mode: Mode = 'menu';
  seed = '';
  practice = false;
  private yaw = 0;
  private pitch = 0;
  private intentionalUnlock = false;
  private outcomeT = 0;
  private settingsReturn: 'menu' | 'pause' = 'menu';
  private runCount = 0;

  constructor() {
    this.settings.load();
    this.renderer = new GameRenderer(this.canvas);
    this.input = new Input(this.canvas, {
      onLockChange: (locked) => this.onLockChange(locked),
      onLockError: () => {},
      onFocusLost: () => this.onFocusLost(),
      capturing: () => this.mode === 'playing' || this.mode === 'map' || this.mode === 'rune',
    });
    this.input.attach();
    this.applySettings();
    this.bindUi();
    window.addEventListener('resize', () => this.resize());
    // 遊戲中滑鼠未鎖定（也不是備用模式）時，點畫面就重新要求鎖定（點擊本身是使用者手勢）
    this.canvas.addEventListener('mousedown', () => {
      if (this.mode === 'playing' && !this.input.locked && !this.input.fallback) void this.input.requestLock();
    });
    this.resize();
    if (!this.settings.persistent) $('storage-note').textContent = '瀏覽器封鎖了本機儲存：設定只在本次遊玩有效。';
    const touchOnly = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
    this.show(touchOnly ? 'screen-mobile' : 'screen-menu');
    this.loop.start((dt) => this.frame(dt));
  }

  // ---------- 介面 ----------

  private show(id: string | null): void {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  }

  private bindUi(): void {
    const click = (id: string, fn: () => void) =>
      $(id).addEventListener('click', () => {
        this.sfx.unlock();
        this.sfx.ui('click');
        fn();
      });
    click('btn-start', () => {
      const raw = normalizeSeed(($('seed-input') as HTMLInputElement).value);
      this.startRun(raw || randomSeed(), false);
    });
    click('btn-seed-random', () => (($('seed-input') as HTMLInputElement).value = randomSeed()));
    click('btn-practice', () => this.startRun('PRACTICE', true));
    click('btn-settings', () => this.openSettings('menu'));
    click('btn-help', () => this.show('screen-help'));
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('button.back')))
      b.addEventListener('click', () => {
        this.sfx.ui('click');
        if (b.closest('#screen-settings') && this.settingsReturn === 'pause') this.show('screen-pause');
        else this.show('screen-menu');
      });
    click('btn-resume', () => this.resume());
    click('btn-restart', () => this.startRun(this.seed, this.practice));
    click('btn-pause-settings', () => this.openSettings('pause'));
    click('btn-quit', () => this.toMenu());
    click('btn-retry', () => this.startRun(this.seed, this.practice));
    click('btn-new', () => this.startRun(randomSeed(), false));
    click('btn-menu', () => this.toMenu());
    click('btn-mobile-continue', () => this.show('screen-menu'));
    for (const card of Array.from(document.querySelectorAll<HTMLButtonElement>('.rune-card')))
      card.addEventListener('click', () => this.chooseRune(Number(card.dataset.idx)));
    // 設定
    const bindRange = (id: string, out: string, key: 'sensitivity' | 'fov' | 'masterVolume' | 'sfxVolume' | 'pixelRatio', fmt: (v: number) => string) => {
      const el = $<HTMLInputElement>(id);
      el.addEventListener('input', () => {
        this.settings.update({ [key]: Number(el.value) });
        $(out).textContent = fmt(Number(el.value));
        this.applySettings();
      });
    };
    bindRange('set-sens', 'out-sens', 'sensitivity', (v) => v.toFixed(2));
    bindRange('set-fov', 'out-fov', 'fov', (v) => `${v}°`);
    bindRange('set-master', 'out-master', 'masterVolume', (v) => `${Math.round(v * 100)}`);
    bindRange('set-sfx', 'out-sfx', 'sfxVolume', (v) => `${Math.round(v * 100)}`);
    bindRange('set-pr', 'out-pr', 'pixelRatio', (v) => v.toFixed(2));
    $<HTMLInputElement>('set-invert').addEventListener('change', (e) => {
      this.settings.update({ invertY: (e.target as HTMLInputElement).checked });
    });
    $<HTMLInputElement>('set-reduced').addEventListener('change', (e) => {
      this.settings.update({ reducedMotion: (e.target as HTMLInputElement).checked });
      this.applySettings();
    });
    $<HTMLInputElement>('seed-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btn-start').click();
    });
  }

  private openSettings(from: 'menu' | 'pause'): void {
    this.settingsReturn = from;
    const s = this.settings.value;
    const setR = (id: string, out: string, v: number, txt: string) => {
      $<HTMLInputElement>(id).value = String(v);
      $(out).textContent = txt;
    };
    setR('set-sens', 'out-sens', s.sensitivity, s.sensitivity.toFixed(2));
    setR('set-fov', 'out-fov', s.fov, `${s.fov}°`);
    setR('set-master', 'out-master', s.masterVolume, `${Math.round(s.masterVolume * 100)}`);
    setR('set-sfx', 'out-sfx', s.sfxVolume, `${Math.round(s.sfxVolume * 100)}`);
    setR('set-pr', 'out-pr', s.pixelRatio, s.pixelRatio.toFixed(2));
    $<HTMLInputElement>('set-invert').checked = s.invertY;
    $<HTMLInputElement>('set-reduced').checked = s.reducedMotion;
    $('settings-note').textContent = this.settings.persistent ? '設定會自動儲存。' : '無法使用本機儲存：設定只在本次遊玩有效。';
    this.show('screen-settings');
  }

  private applySettings(): void {
    const s = this.settings.value;
    this.sfx.setVolumes(s.masterVolume, s.sfxVolume);
    this.renderer.setOptions({ fov: s.fov, pixelRatio: s.pixelRatio, reducedMotion: s.reducedMotion });
    this.resize();
  }

  private resize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  // ---------- 流程 ----------

  /** 必須在使用者手勢中呼叫（取得滑鼠鎖定與啟用音訊）。 */
  startRun(seed: string, practice: boolean, fromGesture = true): void {
    this.sfx.unlock();
    this.intentionalUnlock = false;
    // 沒有使用者手勢時（練習場自動重置）不要求鎖定，也不改變目前的操作模式
    const lockP = fromGesture ? this.input.requestLock() : Promise.resolve(this.input.locked || !this.input.fallback);
    this.seed = seed;
    this.practice = practice;
    this.mode = 'loading';
    this.hud.show(false);
    $('loading-seed').textContent = practice ? '練習場' : `種子 ${seed}`;
    this.show('screen-loading');
    window.setTimeout(() => {
      this.renderer.clearWorld();
      this.world = null;
      const level = generateLevel(seed, { practice });
      const w = new World(level);
      this.world = w;
      this.yaw = level.spawn.yaw;
      this.pitch = 0;
      w.player.yaw = this.yaw;
      this.renderer.setWorld(w);
      this.hud.reset();
      this.outcomeT = 0;
      this.runCount++;
      void lockP.then((ok) => {
        if (this.world !== w) return;
        this.input.fallback = !ok;
        this.hud.setLockBanner(!ok);
        if (!ok) this.flashLockFail();
        this.enterPlaying();
        const hint = practice
          ? '練習場：左側有睡著的盾衛可以練習背刺，右邊房間有弩手與突進者。補給台（E）可補滿物資。'
          : '靜止時世界以慢動作流動；移動、攻擊、使用道具時，世界以正常速度前進。';
        this.hud.hint(`start${this.runCount}`, hint, 8);
      });
    }, 30);
  }

  private flashLockFail(): void {
    const el = $('lock-fail');
    el.textContent = '無法鎖定滑鼠（瀏覽器或內嵌環境限制）。已切換為備用操作：按住右鍵拖曳或用方向鍵轉視角，左鍵攻擊。';
    el.classList.remove('hidden');
    window.setTimeout(() => el.classList.add('hidden'), 6000);
  }

  private enterPlaying(): void {
    this.mode = 'playing';
    this.show(null);
    this.hud.show(true);
    this.loop.resetClock();
    this.sfx.resume();
    this.canvas.focus();
  }

  pause(reason: string): void {
    if (this.mode !== 'playing' && this.mode !== 'map') return;
    this.mode = 'paused';
    this.input.clear();
    $('pause-info').textContent = `${this.practice ? '練習場' : `種子 ${this.seed}`} ${reason}`;
    $('resume-msg').classList.add('hidden');
    $('btn-restart').textContent = this.practice ? '重置練習' : '重新開始（同種子）';
    this.show('screen-pause');
    this.sfx.suspend();
    // 暫停時一定釋放滑鼠，讓玩家能點「繼續」
    if (this.input.locked) {
      this.intentionalUnlock = true;
      this.input.exitLock();
    }
  }

  private resume(): void {
    if (this.mode !== 'paused' || !this.world) return;
    if (this.input.fallback || this.input.locked) {
      this.enterPlaying();
      return;
    }
    void this.input.requestLock().then((ok) => {
      if (this.mode !== 'paused') return;
      if (ok) this.enterPlaying();
      else if (this.input.lockEverWorked) {
        const m = $('resume-msg');
        m.textContent = '瀏覽器剛解除滑鼠鎖定，需要約一秒才能再次鎖定，請再按一次「繼續」。';
        m.classList.remove('hidden');
      } else {
        this.input.fallback = true;
        this.hud.setLockBanner(true);
        this.flashLockFail();
        this.enterPlaying();
      }
    });
  }

  private toMenu(): void {
    this.intentionalUnlock = true;
    this.input.exitLock();
    this.renderer.clearWorld();
    this.world = null;
    this.mode = 'menu';
    this.hud.show(false);
    this.hud.reset();
    this.show('screen-menu');
  }

  private onLockChange(locked: boolean): void {
    if (locked) return;
    if (this.intentionalUnlock) {
      this.intentionalUnlock = false;
      return;
    }
    if (this.mode === 'playing' || this.mode === 'map') this.pause('（滑鼠鎖定已解除）');
  }

  private onFocusLost(): void {
    if (this.mode === 'playing' || this.mode === 'map') this.pause('（視窗失去焦點）');
  }

  private openRune(): void {
    const w = this.world!;
    const it = w.interactables.find((i) => i.id === w.pendingAltar);
    if (!it) return;
    const offer = w.level.altars[it.ref]!.offer;
    const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('.rune-card'));
    offer.forEach((id, k) => {
      const info = runeInfo(id);
      const c = cards[k]!;
      c.dataset.rune = id;
      c.querySelector('h3')!.textContent = info.name;
      c.querySelector('p')!.textContent = info.text;
    });
    this.mode = 'rune';
    this.show('screen-rune');
    this.sfx.ui('open');
  }

  private chooseRune(idx: number): void {
    if (this.mode !== 'rune' || !this.world) return;
    const card = document.querySelectorAll<HTMLButtonElement>('.rune-card')[idx];
    const id = card?.dataset.rune as RuneId | undefined;
    if (!id) return;
    this.world.chooseRune(id);
    const ev = this.world.drainEvents();
    this.sfx.onEvents(ev);
    this.hud.onEvents(ev, this.world);
    this.enterPlaying();
    if (!this.input.locked && !this.input.fallback) void this.input.requestLock();
  }

  private showResults(): void {
    const w = this.world!;
    this.intentionalUnlock = true;
    this.input.exitLock();
    this.mode = 'results';
    this.hud.show(false);
    const win = w.outcome === 'win';
    $('res-title').textContent = win ? '成功撤離！' : '你倒下了';
    const tpl = `${w.level.templateName}${w.level.mirrored ? '（鏡像）' : ''}`;
    $('res-sub').textContent = this.practice ? '練習場' : `種子 ${this.seed} · 地城「${tpl}」 · 時間：慢動作`;
    const s = w.stats;
    const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const dmg = Object.entries(s.damageTaken)
      .map(([k, v]) => `${k} ${v}`)
      .join('、');
    const rows: Array<[string, string]> = [
      ['結果', win ? '帶著沉眠之心離開' : `死亡${w.deathCause ? `（${w.deathCause}）` : ''}`],
      ['沉眠之心', w.heartTaken ? '已取得' : '未取得'],
      ['真實時間', mmss(s.realTime)],
      ['世界時間', mmss(s.worldTime)],
      ['擊倒敵人', `${s.kills}（背刺 ${s.backstabs} 次）`],
      ['弩／投石命中', `${s.shotHits} / ${s.shots}`],
      ['空中擊破瓶子', String(s.airbursts)],
      ['煙霧瓶／藥水', `${s.bottlesThrown} / ${s.potionsUsed}`],
      ['打開寶箱', String(s.chests)],
      ['刻印', w.player.runes.map((r) => runeInfo(r).name).join('、') || '無'],
      ['受到傷害', dmg || '無'],
    ];
    $('res-stats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('btn-retry').textContent = this.practice ? '重置練習' : '同種子再試';
    this.show('screen-results');
  }

  // ---------- 每幀 ----------

  readonly perf = { frames: 0, simMs: 0, renderMs: 0, hudMs: 0 };

  private frame(frameDt: number): void {
    const t0 = performance.now();
    const realDt = clampRealDt(frameDt);
    const w = this.world;
    const raw = this.input.consume();
    if (w && this.mode === 'playing') {
      if (raw.map) {
        this.mode = 'map';
        drawMap($<HTMLCanvasElement>('map-canvas'), w);
        $('map-title').textContent = `地圖${this.practice ? '' : ` · 種子 ${this.seed}`}`;
        this.show('screen-map');
      } else if (raw.escape) {
        // 鎖定中按 Esc 通常由瀏覽器解除鎖定；若頁面仍收到 Esc，也直接暫停
        this.pause('');
      } else {
        const s = this.settings.value;
        const sens = 0.0022 * s.sensitivity;
        this.yaw -= raw.lookDX * sens;
        this.pitch -= raw.lookDY * sens * (s.invertY ? -1 : 1);
        this.yaw += raw.keyYaw * 2.2 * realDt;
        this.pitch += raw.keyPitch * 1.5 * realDt;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
        const fi: FrameInput = {
          moveX: raw.moveX,
          moveZ: raw.moveZ,
          yaw: this.yaw,
          pitch: this.pitch,
          fire: raw.fire,
          firePressed: raw.firePressed,
          selectTool: raw.selectTool,
          bottle: raw.bottle,
          interact: raw.interact,
          potion: raw.potion,
          wait: raw.wait,
        };
        w.frame(realDt, fi);
        const events = w.drainEvents();
        this.renderer.onEvents(events);
        this.sfx.setListener(w.player.x, w.player.z, w.player.yaw);
        this.sfx.onEvents(events);
        this.hud.onEvents(events, w);
        this.devLog(events);
        if (w.pendingAltar !== null) this.openRune();
        if (w.outcome !== 'none') {
          this.outcomeT += realDt;
          const delay = w.outcome === 'win' ? 0.8 : 1.6;
          if (this.outcomeT >= delay) {
            if (this.practice && w.outcome === 'dead') this.startRun(this.seed, true, false);
            else this.showResults();
          }
        }
      }
    } else if (w && this.mode === 'map') {
      if (raw.map || raw.escape) this.enterPlaying();
    } else if (w && this.mode === 'rune') {
      if (raw.digit === 1 || raw.digit === 2) this.chooseRune(raw.digit - 1);
    }
    const t1 = performance.now();
    if (w) {
      this.sfx.setSlow(this.mode === 'playing' ? (this.renderer.shared.uSlow.value as number) : 0);
      this.renderer.render(realDt, this.mode !== 'playing');
      const t2 = performance.now();
      if (this.mode === 'playing') this.hud.update(w, this.renderer, realDt);
      this.perf.renderMs += t2 - t1;
      this.perf.hudMs += performance.now() - t2;
    } else this.renderer.render(realDt, true);
    this.perf.simMs += t1 - t0;
    this.perf.frames++;
  }

  /** 除錯用：直接設定視角（狀態注入）。 */
  setView(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  get view(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  // ---------- 開發模式 ----------
  devEvents: Array<{ t: number; type: string; [k: string]: unknown }> = [];
  private devLog(events: ReturnType<World['drainEvents']>): void {
    if (!this.devEnabled) return;
    for (const e of events) {
      if (e.type === 'noise') continue;
      this.devEvents.push({ t: this.world?.time ?? 0, ...e });
    }
    if (this.devEvents.length > 400) this.devEvents.splice(0, this.devEvents.length - 400);
  }
  devEnabled = false;
}

const app = new App();
if (new URLSearchParams(location.search).has('dev')) {
  app.devEnabled = true;
  installDevApi(app);
}
