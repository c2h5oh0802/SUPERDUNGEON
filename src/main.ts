import './ui/style.css';
import { Sfx } from './audio/sfx';
import { ALL_CLASSES, HEALING_POTION, RUN, TALENTS, TIP_NAMES, TOOL_NAMES, WEAPONS, classInfo, type ClassInfo, type PlayerClass } from './config';
import { addItem, identify, queueUse, upgradeLabel } from './sim/items';
import { focusInventory, renderInventory } from './ui/inventory';
import { clampRealDt } from './core/time';
import { Loop } from './core/loop';
import { normalizeSeed, randomSeed } from './core/rng';
import { installDevApi } from './dev/devapi';
import { PRACTICE_TRIALS, trialForSeed } from './gen/practiceTrials';
import { createTrialWorld } from './sim/practiceTrials';
import { generateLevel } from './gen/validate';
import { Input } from './input/input';
import { TouchInput } from './input/touch';
import { mergeInput } from './input/merge';
import { GameRenderer } from './render/renderer';
import type { FrameInput } from './sim/types';
import { World } from './sim/world';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun, type RunState } from './sim/run';
import { Hud } from './ui/hud';
import { drawMap } from './ui/mapView';
import { SettingsStore } from './ui/settings';
import { FullscreenControls } from './ui/fullscreen';
import { gameViewport } from './ui/viewport';

type Mode = 'menu' | 'loading' | 'playing' | 'paused' | 'map' | 'choice' | 'inventory' | 'results';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SCREENS = ['screen-menu', 'screen-trials', 'screen-help', 'screen-class', 'screen-choice', 'screen-inventory', 'screen-settings', 'screen-pause', 'screen-map', 'screen-results', 'screen-loading', 'screen-mobile'];

export class App {
  readonly canvas = $<HTMLCanvasElement>('game');
  readonly settings = new SettingsStore();
  readonly sfx = new Sfx();
  readonly hud = new Hud();
  readonly loop = new Loop();
  readonly renderer: GameRenderer;
  readonly input: Input;
  readonly touch: TouchInput;
  readonly fullscreen: FullscreenControls;
  private pauseAfterLoading = false;
  touchMode = false;
  private rotateBlocked = false;
  private rotateDismissed = false;
  private lastTouchHud = '';
  world: World | null = null;
  mode: Mode = 'menu';
  seed = '';
  practice = false;
  /** 目前這一局的職業。 */
  cls: PlayerClass = 'warrior';
  /** 目前這一局（練習場為 null）。 */
  run: RunState | null = null;
  private yaw = 0;
  private pitch = 0;
  private intentionalUnlock = false;
  private outcomeT = 0;
  private settingsReturn: 'menu' | 'pause' = 'menu';
  private runCount = 0;

  constructor() {
    this.settings.load();
    this.touchMode = this.settings.value.touchControls ?? !!window.matchMedia?.('(pointer: coarse)').matches;
    document.body.classList.toggle('touch-mode', this.touchMode);
    this.hud.setTouchMode(this.touchMode);
    this.renderer = new GameRenderer(this.canvas);
    this.input = new Input(this.canvas, {
      onLockChange: (locked) => this.onLockChange(locked),
      onLockError: () => {},
      onFocusLost: () => this.onFocusLost(),
      capturing: () => this.mode === 'playing' || this.mode === 'map' || this.mode === 'choice' || this.mode === 'inventory',
      inventoryOpen: () => this.mode === 'inventory',
      playing: () => this.mode === 'playing',
      touchMode: () => this.touchMode,
    });
    this.touch = new TouchInput($('touch-controls'), {
      active: () => this.touchMode && this.mode === 'playing' && !this.rotateBlocked,
    });
    this.input.attach();
    this.touch.attach();
    this.fullscreen = new FullscreenControls((active) => {
      this.clearInput();
      this.resize();
      if (!active) {
        if (this.mode === 'loading') this.pauseAfterLoading = true;
        else this.pause('（已退出全螢幕）');
      }
      this.checkOrientation();
    });
    this.applySettings();
    this.cls = this.settings.value.cls;
    this.fillClassTexts();
    this.bindUi();
    this.refreshContinue();
    window.addEventListener('resize', () => {
      this.clearInput();
      this.resize();
      this.checkOrientation();
    });
    // Mobile chrome and keyboards can resize only the visual viewport.
    const visibleResize = () => {
      if (!this.touchMode) return;
      this.clearInput();
      this.resize();
      this.checkOrientation();
    };
    window.visualViewport?.addEventListener('resize', visibleResize);
    window.visualViewport?.addEventListener('scroll', visibleResize);
    // 遊戲中滑鼠未鎖定（也不是備用模式）時，點畫面就重新要求鎖定（點擊本身是使用者手勢）
    this.canvas.addEventListener('mousedown', () => {
      if (!this.touchMode && this.mode === 'playing' && !this.input.locked && !this.input.fallback) void this.input.requestLock();
    });
    this.resize();
    if (!this.settings.persistent) $('storage-note').textContent = '瀏覽器封鎖了本機儲存：設定只在本次遊玩有效。';
    this.show(this.touchMode ? 'screen-mobile' : 'screen-menu');
    this.loop.start((dt) => this.frame(dt));
  }

  // ---------- 介面 ----------

  private show(id: string | null): void {
    if (id !== null) this.clearInput();
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    $('touch-controls').classList.toggle('hidden', id !== null || !this.touchMode || this.rotateBlocked);
  }

  private clearInput(): void {
    this.input.clear();
    this.touch.clear();
  }

  private setTouchMode(enabled: boolean): void {
    this.clearInput();
    this.touchMode = enabled;
    this.settings.update({ touchControls: enabled });
    document.body.classList.toggle('touch-mode', enabled);
    this.hud.setTouchMode(enabled);
    this.resize();
    if (enabled && this.input.locked) {
      this.intentionalUnlock = true;
      this.input.exitLock();
    }
    // Desktop pointer-lock fallback is independent of the chosen touch UI.
    this.input.fallback = false;
    this.hud.setLockBanner(false);
    this.checkOrientation();
  }

  private checkOrientation(): void {
    const portrait = this.touchMode && window.innerHeight > window.innerWidth;
    if (!portrait) this.rotateDismissed = false;
    if (portrait && this.mode === 'playing') {
      this.rotateDismissed = false;
      this.pause('（請將手機橫放）');
    }
    this.rotateBlocked = portrait && this.world !== null && this.mode === 'paused' && !this.rotateDismissed;
    $('touch-rotate').classList.toggle('hidden', !this.rotateBlocked);
    $('touch-controls').classList.toggle('hidden', !this.touchMode || this.mode !== 'playing' || this.rotateBlocked);
  }

  private updateTouchHud(): void {
    if (!this.touchMode || !this.world) return;
    const p = this.world.player;
    const key = [p.cls, p.tool, p.desiredTool, p.weapon.id, p.tipKind, p.arrows, p.stones,
      p.tipped.chill, p.tipped.paralysis, p.bottles, this.world.interactTarget?.enabled].join('|');
    if (key === this.lastTouchHud) return;
    this.lastTouchHud = key;
    $('touch-shield').classList.toggle('hidden', p.cls !== 'warrior');
    for (let slot = 1; slot <= 3; slot++) {
      const button = $<HTMLButtonElement>(`touch-slot-${slot}`), tool = p.slots[slot - 1];
      button.classList.toggle('hidden', !tool);
      if (!tool) continue;
      button.querySelector('.touch-label')!.textContent = tool === 'melee' ? WEAPONS[p.weapon.id].name : tool === 'tipped' ? TIP_NAMES[p.tipKind] : TOOL_NAMES[tool];
      button.querySelector('.touch-count')!.textContent = tool === 'bow' ? String(p.arrows) : tool === 'stone' ? String(p.stones) : tool === 'tipped' ? String(p.tipped[p.tipKind]) : '';
      button.classList.toggle('selected', p.desiredTool === tool);
      button.setAttribute('aria-pressed', String(p.desiredTool === tool));
    }
    $('touch-bottle').setAttribute('aria-label', `煙霧瓶，剩餘 ${p.bottles} 瓶`);
    $('touch-bottle').querySelector('.touch-count')!.textContent = String(p.bottles);
    $('touch-interact').classList.toggle('available', !!this.world.interactTarget?.enabled);
    $('touch-fire').querySelector('.touch-label')!.textContent = p.tool === 'bow' || p.tool === 'tipped' ? '射擊' : p.tool === 'stone' ? '投擲' : '攻擊';
  }

  /** 職業完整說明（起始裝備、職業規則、擅長與弱點、代表性的一刻），全部由 config 的數值生成。 */
  static classDetailHtml(info: ClassInfo): string {
    const gear = info.loadout.map((l) => `<li><kbd>${l.key}</kbd><b class="nm">${l.name}</b>：${l.text}</li>`).join('');
    const rules = info.abilities.map((a) => `<li><b class="nm">${a.name}</b>：${a.text}</li>`).join('');
    const moments = info.moments.map((m) => `<li>${m}</li>`).join('');
    return [
      `<p class="cd-summary">${info.summary}</p>`,
      `<h4>起始裝備</h4><ul>${gear}</ul><p class="muted">${info.common}</p>`,
      `<h4>職業規則</h4><ul>${rules}</ul>`,
      `<h4>擅長與弱點</h4><ul><li>${info.strengths}</li><li>${info.weaknesses}</li></ul>`,
      `<h4>天賦（每兩級二選一）</h4><ul>${info.talents.map((t) => `<li><b class="nm">${t.name}</b>：${t.text}</li>`).join('')}</ul>`,
      `<h4>代表性的一刻</h4><ul>${moments}</ul>`,
    ].join('');
  }

  /** 職業卡與說明文字由 config 的數值生成。 */
  private fillClassTexts(): void {
    for (const card of Array.from(document.querySelectorAll<HTMLButtonElement>('.class-card'))) {
      const info = classInfo(card.dataset.cls as PlayerClass);
      card.querySelector('.cls-name')!.textContent = info.name;
      card.querySelector('.cls-promise')!.textContent = `「${info.promise}」`;
      card.querySelector('.cls-abil')!.textContent = info.loadout.map((l) => l.name).join('・');
    }
    $('help-classes').innerHTML = ALL_CLASSES.map((id) => {
      const info = classInfo(id);
      return `<div><h4 class="${id}">${info.name}</h4><p class="muted">「${info.promise}」</p><div class="class-detail ${id}">${App.classDetailHtml(info)}</div></div>`;
    }).join('');
    this.selectClass(this.cls);
  }

  private selectClass(cls: PlayerClass): void {
    this.cls = cls;
    if (this.settings.value.cls !== cls) this.settings.update({ cls });
    for (const card of Array.from(document.querySelectorAll<HTMLButtonElement>('.class-card')))
      card.setAttribute('aria-checked', String(card.dataset.cls === cls));
    const el = $('class-detail');
    el.className = `class-detail ${cls}`;
    el.innerHTML = App.classDetailHtml(classInfo(cls));
  }

  private openClassScreen(): void {
    const info = classInfo(this.cls);
    $('class-screen-title').textContent = `${info.name}「${info.promise}」`;
    const body = $('class-screen-body');
    body.className = `class-detail ${this.cls}`;
    body.innerHTML = App.classDetailHtml(info);
    this.show('screen-class');
  }

  private otherClass(): PlayerClass {
    return this.cls === 'warrior' ? 'huntress' : 'warrior';
  }

  private bindUi(): void {
    for (const card of Array.from(document.querySelectorAll<HTMLButtonElement>('.class-card')))
      card.addEventListener('click', () => {
        this.sfx.unlock();
        this.sfx.ui('click');
        this.selectClass(card.dataset.cls as PlayerClass);
      });
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
    click('btn-continue', () => {
      const saved = App.loadRun();
      if (!saved) return this.refreshContinue();
      this.selectClass(saved.cls);
      this.startFloor(saved, true);
    });
    click('btn-seed-random', () => (($('seed-input') as HTMLInputElement).value = randomSeed()));
    click('btn-practice', () => this.startRun('PRACTICE', true));
    click('btn-trials', () => this.show('screen-trials'));
    for (const trial of PRACTICE_TRIALS) click(`btn-${trial.id}`, () => this.startRun(trial.seed, true));
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
    click('btn-pause-class', () => this.openClassScreen());
    click('btn-inv-close', () => this.closeInventory());
    click('btn-map-close', () => { if (this.mode === 'map') this.backToPlay(); });
    click('btn-class-back', () => this.show('screen-pause'));
    click('btn-quit', () => this.toMenu());
    click('btn-retry', () => this.startRun(this.seed, this.practice));
    click('btn-swap', () => {
      this.selectClass(this.otherClass());
      this.startRun(this.seed, this.practice);
    });
    click('btn-new', () => this.startRun(randomSeed(), false));
    click('btn-menu', () => this.toMenu());
    click('btn-mobile-continue', () => { this.setTouchMode(true); void this.fullscreen.enter(true); this.show('screen-menu'); });
    click('btn-mobile-keyboard', () => { this.setTouchMode(false); this.show('screen-menu'); });
    click('btn-rotate-menu', () => this.toMenu());
    click('btn-rotate-pause', () => { this.rotateDismissed = true; this.checkOrientation(); });
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
    $<HTMLInputElement>('set-touch').addEventListener('change', (e) => {
      this.setTouchMode((e.target as HTMLInputElement).checked);
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
    $<HTMLInputElement>('set-touch').checked = this.touchMode;
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
    const viewport = gameViewport(window, this.touchMode);
    for (const key of ['width', 'height', 'left', 'top'] as const) {
      if (this.touchMode) document.body.style.setProperty(`--view-${key}`, `${viewport[key]}px`);
      else document.body.style.removeProperty(`--view-${key}`);
    }
    this.renderer.resize(viewport.width, viewport.height);
  }

  // ---------- 流程 ----------

  // ---------- 存檔：每層開頭自動存一次 ----------

  private static readonly SAVE_KEY = 'superdungeon.run.v1';

  static loadRun(): RunState | null {
    try {
      return parseRun(window.localStorage.getItem(App.SAVE_KEY));
    } catch {
      return null;
    }
  }

  private saveRun(run: RunState | null): void {
    try {
      if (run) window.localStorage.setItem(App.SAVE_KEY, serializeRun(run));
      else window.localStorage.removeItem(App.SAVE_KEY);
    } catch {
      // 儲存被封鎖：這一局照玩，只是不能續玩
    }
    this.refreshContinue();
  }

  private refreshContinue(): void {
    const saved = App.loadRun();
    const btn = $<HTMLButtonElement>('btn-continue');
    btn.classList.toggle('hidden', !saved);
    if (saved) btn.textContent = `繼續：第 ${saved.floor} / ${RUN.floors} 層 · ${classInfo(saved.cls).name} · 種子 ${saved.seed}`;
  }

  /** 必須在使用者手勢中呼叫（取得滑鼠鎖定與啟用音訊）。 */
  startRun(seed: string, practice: boolean, fromGesture = true): void {
    if (practice) {
      this.run = null;
      this.startWorld(seed, true, fromGesture, () => {
        const trial = trialForSeed(seed);
        if (trial) return createTrialWorld(trial.id, this.cls);
        const w = new World(generateLevel(seed, { practice: true }), { cls: this.cls });
        identify(w, 'potion:healing');
        for (let k = 0; k < HEALING_POTION.practiceCount; k++) addItem(w, 'potion:healing');
        // 練習場：先給幾樣東西試（背包 I）
        for (const id of ['potion:fire', 'potion:frost', 'potion:gas', 'scroll:sleep', 'scroll:upgrade', 'weapon:axe'] as const) addItem(w, id);
        return w;
      });
      return;
    }
    this.startFloor(newRun(seed, this.cls), fromGesture);
  }

  /** 開始（或繼續）一局的某一層；進入時自動存檔。 */
  private startFloor(run: RunState, fromGesture: boolean): void {
    this.run = run;
    this.cls = run.cls;
    this.saveRun(run);
    this.startWorld(run.seed, false, fromGesture, () => createFloorWorld(run));
  }

  private startWorld(seed: string, practice: boolean, fromGesture: boolean, make: () => World): void {
    this.sfx.unlock();
    this.intentionalUnlock = false;
    this.pauseAfterLoading = false;
    if (this.touchMode && fromGesture) void this.fullscreen.enter(true);
    // 沒有使用者手勢時（練習場自動重置、走下階梯）不要求鎖定，也不改變目前的操作模式
    const lockP = this.touchMode ? Promise.resolve(true) : fromGesture ? this.input.requestLock() : Promise.resolve(this.input.locked || !this.input.fallback);
    this.seed = seed;
    this.practice = practice;
    this.mode = 'loading';
    this.hud.show(false);
    const info = classInfo(this.cls);
    const floor = this.run?.floor ?? 1;
    $('loading-seed').textContent = `${info.name} · ${practice ? (trialForSeed(seed)?.name ?? '練習場') : `種子 ${seed} · 第 ${floor} / ${RUN.floors} 層`}`;
    this.show('screen-loading');
    window.setTimeout(() => {
      this.renderer.clearWorld();
      this.world = null;
      const w = make();
      this.world = w;
      const level = w.level;
      this.yaw = level.spawn.yaw;
      this.pitch = 0;
      w.player.yaw = this.yaw;
      this.renderer.setWorld(w);
      this.hud.reset();
      this.outcomeT = 0;
      this.runCount++;
      void lockP.then((ok) => {
        if (this.world !== w) return;
        this.input.fallback = !ok && !this.touchMode;
        this.hud.setLockBanner(!ok && !this.touchMode);
        if (!ok && !this.touchMode) this.flashLockFail();
        this.enterPlaying();
        if (!practice && floor > 1) {
          this.hud.hint(
            `floor${this.runCount}`,
            floor === RUN.floors
              ? `第 ${floor} 層（最底層）：先擊倒守心者，才能取走沉眠之心。進入戰鬥後飢餓暫停。`
              : `第 ${floor} 層：敵人更多、醒著的更多。物資與生命都帶下來了；已自動存檔。`,
            7,
          );
          return;
        }
        const clsHint = this.touchMode
          ? this.cls === 'warrior'
            ? '左側搖桿移動，右側滑動轉向。按攻擊出手；也能按住攻擊並滑動瞄準。敵人攻擊鎖定時可反擊，推擊讓近身敵人退開。'
            : '左側搖桿移動，右側滑動瞄準；按射擊後會自動拉弓出箭，鬆手不取消這一箭，按住會連射。再按目前藥劑箭可切換種類。'
          : this.cls === 'warrior'
            ? '戰士（1 長劍、2 投擲石、右鍵/F 推擊）：敵人的攻擊鎖定、就在眼前時準星下出現「反擊」；敵人貼身時出現「推擊」。'
            : '獵手（1 獵刀、2 獵弓、3 藥劑箭）：麻痺箭讓敵人的時間軸暫停，冰寒箭讓它變慢；再按一次 3 切換。暫停選單有完整職業說明。';
        const trial = practice ? trialForSeed(seed) : undefined;
        const hint = trial ? `${trial.name}：${trial.hint} Esc 可重置。` : practice
          ? '練習場：左邊有睡著與巡邏的盾衛，右邊房間有高台弩手與突進者，補給台（E）可補滿物資。'
          : `地城共 ${RUN.floors} 層：前四層探索補給，第五層擊倒守心者後取得沉眠之心。靜止時世界以慢動作流動。`;
        this.hud.hint(`start${this.runCount}`, hint, 6);
        // 職業提示排在後面，一次只顯示一則
        this.hud.hint(`cls${this.runCount}`, clsHint, 9);
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
    this.clearInput();
    this.mode = 'playing';
    this.show(null);
    this.hud.show(true);
    this.loop.resetClock();
    this.sfx.resume();
    this.canvas.focus();
    this.updateTouchHud();
    this.checkOrientation();
    if (this.pauseAfterLoading) {
      this.pauseAfterLoading = false;
      this.pause('（已退出全螢幕）');
    }
  }

  pause(reason: string): void {
    if (this.mode !== 'playing' && this.mode !== 'map') return;
    this.mode = 'paused';
    this.clearInput();
    $('pause-info').textContent = `${classInfo(this.cls).name} · ${this.practice ? (trialForSeed(this.seed)?.name ?? '練習場') : `種子 ${this.seed} · 第 ${this.run?.floor ?? 1} / ${RUN.floors} 層`} ${reason}`;
    if (this.world?.level.practiceTrial) {
      const w = this.world;
      const damage = Object.values(w.stats.damageTaken).reduce((sum, n) => sum + n, 0);
      $('pause-info').textContent += ` · 世界 ${w.time.toFixed(1)} 秒 · 承傷 ${damage} · 射擊 ${w.stats.shots} · 道具 ${w.stats.itemsUsed}`;
    }
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
    if (this.touchMode || this.input.fallback || this.input.locked) {
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
    this.rotateBlocked = false;
    $('touch-rotate').classList.add('hidden');
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
    if (!this.touchMode && (this.mode === 'playing' || this.mode === 'map')) this.pause('（滑鼠鎖定已解除）');
  }

  private onFocusLost(): void {
    this.clearInput();
    if (this.mode === 'playing' || this.mode === 'map') this.pause('（視窗失去焦點）');
  }

  /** 天賦或強化的選擇畫面（世界暫停）。 */
  private openChoice(): void {
    const w = this.world!;
    const c = w.pendingChoice;
    if (!c) return;
    const cards =
      c.kind === 'talent'
        ? c.options.map((t) => ({ name: TALENTS[t].name, text: TALENTS[t].text }))
        : c.options.map((t) => upgradeLabel(w, t));
    $('choice-title').textContent = c.kind === 'talent' ? `升到第 ${w.player.level} 級：選一個天賦` : '強化卷軸：選一件裝備強化';
    $('choice-sub').textContent = c.kind === 'talent' ? '天賦本局有效。按數字鍵或直接點選。' : '只列出仍有實際收益的裝備；封頂後不再消耗卷軸。強化跟著裝備保留並跨層。按數字鍵或直接點選。';
    const box = $('choice-cards');
    box.innerHTML = cards
      .map((_, k) => `<button class="choice-card" data-idx="${k}"><kbd>${k + 1}</kbd><h3></h3><p></p></button>`)
      .join('');
    const btns = Array.from(box.querySelectorAll<HTMLButtonElement>('.choice-card'));
    btns.forEach((b, k) => {
      b.querySelector('h3')!.textContent = cards[k]!.name;
      b.querySelector('p')!.textContent = cards[k]!.text;
      b.addEventListener('click', () => this.choose(k));
    });
    this.releaseForUi();
    this.mode = 'choice';
    this.show('screen-choice');
    this.sfx.ui('open');
  }

  private choose(idx: number): void {
    if (this.mode !== 'choice' || !this.world) return;
    const w = this.world;
    if (!w.pendingChoice || idx >= w.pendingChoice.options.length) return;
    w.resolveChoice(idx);
    const ev = w.drainEvents();
    this.sfx.onEvents(ev);
    this.hud.onEvents(ev, w);
    if (w.pendingChoice) this.openChoice();
    else this.backToPlay();
  }

  /** 開背包、選擇畫面時放開滑鼠讓玩家點選（不觸發暫停）。 */
  private releaseForUi(): void {
    this.clearInput();
    if (this.input.locked) {
      this.intentionalUnlock = true;
      this.input.exitLock();
    }
  }

  private backToPlay(): void {
    this.enterPlaying();
    if (!this.touchMode && !this.input.locked && !this.input.fallback) void this.input.requestLock();
  }

  private openInventory(): void {
    const w = this.world!;
    renderInventory(w, (index, mode) => {
      queueUse(w, index, mode);
      this.sfx.ui('click');
      this.closeInventory();
    });
    this.releaseForUi();
    this.mode = 'inventory';
    this.show('screen-inventory');
    focusInventory();
    this.sfx.ui('open');
  }

  private closeInventory(): void {
    if (this.mode !== 'inventory') return;
    this.clearInput();
    this.backToPlay();
  }

  private showResults(): void {
    const w = this.world!;
    this.intentionalUnlock = true;
    this.input.exitLock();
    this.mode = 'results';
    this.hud.show(false);
    const win = w.outcome === 'win';
    // 一局結束：清除存檔
    if (!this.practice) this.saveRun(null);
    $('res-title').textContent = win ? '取得沉眠之心！' : '你倒下了';
    const tpl = `${w.level.templateName}${w.level.mirrored ? '（鏡像）' : ''}`;
    const info = classInfo(w.player.cls);
    $('res-sub').textContent = `${info.name} · ${this.practice ? (trialForSeed(this.seed)?.name ?? '練習場') : `種子 ${this.seed} · 地城「${tpl}」`}`;
    const s = w.stats;
    const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const dmg = Object.entries(s.damageTaken)
      .map(([k, v]) => `${k} ${v}`)
      .join('、');
    const rows: Array<[string, string]> = [
      ['結果', win ? '在最底層取得沉眠之心' : `死亡${w.deathCause ? `（${w.deathCause}）` : ''}`],
      ['到達樓層', this.practice ? '練習場' : `第 ${w.level.floor} / ${RUN.floors} 層`],
      ['真實時間', mmss(s.realTime)],
      ['世界時間', mmss(s.worldTime)],
      ['擊倒敵人', `${s.kills}（背刺 ${s.backstabs} 次）`],
      ['等級', `${w.player.level}${w.player.talents.length ? `（${w.player.talents.map((t) => TALENTS[t].name).join('、')}）` : ''}`],
      ['使用物品', String(s.itemsUsed)],
      [w.player.cls === 'warrior' ? '投擲石命中' : '射箭命中', `${s.shotHits} / ${s.shots}`],
      ...(w.player.cls === 'warrior'
        ? ([
            ['反擊／擊開', `${s.counters} / ${s.deflects}`],
            ['推擊／撞牆', `${s.pushes} / ${s.wallSlams}`],
          ] as Array<[string, string]>)
        : ([['藥劑箭命中', String(s.tipHits)]] as Array<[string, string]>)),
      ['空中擊破瓶子', String(s.airbursts)],
      ['煙霧瓶／藥水', `${s.bottlesThrown} / ${s.potionsUsed}`],
      ['打開寶箱', String(s.chests)],
      ['受到傷害', dmg || '無'],
    ];
    $('res-stats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('btn-retry').textContent = this.practice ? '重置練習' : '同種子再試';
    $('btn-swap').textContent = `換成${classInfo(this.otherClass()).name}${this.practice ? '重置練習' : '（同種子）'}`;
    this.show('screen-results');
  }

  // ---------- 每幀 ----------

  readonly perf = { frames: 0, simMs: 0, renderMs: 0, hudMs: 0 };

  private frame(frameDt: number): void {
    const t0 = performance.now();
    const realDt = clampRealDt(frameDt);
    const w = this.world;
    const raw = mergeInput(this.input.consume(), this.touch.consume());
    if (w && this.mode === 'playing') {
      if (raw.inventory && !w.pendingChoice) {
        this.openInventory();
      } else if (raw.map) {
        // Desktop maps retain their existing pointer lock; touch never owns one.
        this.clearInput();
        this.mode = 'map';
        $('btn-map-close').classList.toggle('hidden', this.input.locked && !this.touchMode);
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
          selectSlot: raw.selectSlot,
          shield: raw.shield,
          sneak: raw.sneak,
          bottle: raw.bottle,
          interact: raw.interact,
          potion: raw.potion,
          wait: raw.wait,
        };
        w.frame(realDt, fi);
        this.updateTouchHud();
        const events = w.drainEvents();
        this.renderer.onEvents(events);
        this.sfx.setListener(w.player.x, w.player.z, w.player.yaw);
        this.sfx.onEvents(events);
        this.hud.onEvents(events, w);
        this.devLog(events);
        if (w.pendingChoice !== null) this.openChoice();
        if (w.outcome !== 'none') {
          this.outcomeT += realDt;
          const delay = w.outcome === 'win' ? 0.8 : w.outcome === 'descend' ? 0.5 : 1.6;
          if (this.outcomeT >= delay) {
            if (this.practice && w.outcome === 'dead') this.startRun(this.seed, true, false);
            else if (w.outcome === 'descend' && this.run) this.startFloor(nextFloor(this.run, w), false);
            else this.showResults();
          }
        }
      }
    } else if (w && this.mode === 'map') {
      if (raw.map || raw.escape) this.backToPlay();
    } else if (w && this.mode === 'choice') {
      if (raw.digit) this.choose(raw.digit - 1);
    } else if (w && this.mode === 'inventory') {
      if (raw.inventory || raw.escape) this.closeInventory();
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
