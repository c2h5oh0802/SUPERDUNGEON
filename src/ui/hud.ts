import { CLASSES, PLAYER, classInfo, runeInfo, type RuneId } from '../config';
import { angleDiff, yawFromDir } from '../core/math';
import type { GameRenderer } from '../render/renderer';
import { AIM_EYE_Y } from '../sim/aim';
import { interceptable } from '../sim/classSys';
import type { GameEvent } from '../sim/types';
import type { World } from '../sim/world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TOOL_NAMES = { sword: '劍', crossbow: '弩', stone: '投石' } as const;

export class Hud {
  private root = $('hud');
  private hpEl = $('hp');
  private objective = $('objective');
  private flowFill = $('flow-fill');
  private flowLabel = $('flow-label');
  private ring = document.getElementById('action-ring') as unknown as SVGCircleElement;
  private prompt = $('prompt');
  private toasts = $('toasts');
  private hintEl = $('hint');
  private heartStatus = $('heart-status');
  private runesEl = $('runes');
  private ammo = $('ammo');
  private bottles = $('bottles');
  private potions = $('potions');
  private icons = $('icons');
  private targets = $('targets');
  private cueEl = $('cue');
  private crosshair = $('crosshair');
  private badge = $('class-badge');
  private tmarks = new Map<number, HTMLDivElement>();
  private hurtArcs = $('hurt-arcs');
  private vignette = $('vignette');
  private lockBanner = $('lock-banner');
  private toolEls = Array.from(document.querySelectorAll<HTMLElement>('.tool'));
  private iconEls = new Map<number, HTMLDivElement>();
  private visible = new Set<number>();
  private visT = 0;
  private last: Record<string, string | number | boolean> = {};
  private hintT = 0;
  private hintQueue: Array<{ text: string; dur: number }> = [];
  private shownHints = new Set<string>();
  private vignT = 0;

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  setLockBanner(on: boolean): void {
    this.lockBanner.classList.toggle('hidden', !on);
  }

  reset(): void {
    for (const el of this.iconEls.values()) el.remove();
    this.iconEls.clear();
    for (const el of this.tmarks.values()) el.remove();
    this.tmarks.clear();
    this.visible.clear();
    this.toasts.innerHTML = '';
    this.hurtArcs.innerHTML = '';
    this.hintEl.textContent = '';
    this.hintT = 0;
    this.hintQueue = [];
    this.last = {};
    this.vignT = 0;
    this.vignette.style.opacity = '0';
  }

  private set(key: string, v: string | number | boolean, apply: () => void): void {
    if (this.last[key] === v) return;
    this.last[key] = v;
    apply();
  }

  toast(text: string, cls = '', dur = 2.2): void {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => (el.style.opacity = '0'), dur * 1000);
    window.setTimeout(() => el.remove(), dur * 1000 + 450);
  }

  /** 一次顯示一則提示；顯示中的提示不會被新的蓋掉，新的排隊（最多 3 則）。 */
  hint(key: string, text: string, dur = 6): void {
    if (this.shownHints.has(key)) return;
    this.shownHints.add(key);
    if (this.hintT > 0) {
      if (this.hintQueue.length < 3) this.hintQueue.push({ text, dur });
      return;
    }
    this.hintEl.textContent = text;
    this.hintT = dur;
  }

  resetHints(): void {
    this.shownHints.clear();
  }

  onEvents(events: GameEvent[], w: World): void {
    const p = w.player;
    for (const e of events) {
      switch (e.type) {
        case 'pickup': {
          const name = e.kind === 'arrows' ? '弩箭' : e.kind === 'bottle' ? '煙霧瓶' : '藥水';
          this.toast(`+${e.amount} ${name}`, 'good', 1.6);
          break;
        }
        case 'playerHurt': {
          const a = yawFromDir((e.x ?? p.x) - p.x, (e.z ?? p.z) - p.z);
          const rel = angleDiff(a, p.yaw);
          const arc = document.createElement('div');
          arc.className = 'hurt-arc';
          arc.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
          this.hurtArcs.appendChild(arc);
          window.setTimeout(() => (arc.style.opacity = '0'), 250);
          window.setTimeout(() => arc.remove(), 1300);
          this.toast(`${e.source ?? '受傷'} −${e.amount}`, 'bad', 1.8);
          this.vignT = 0.6;
          break;
        }
        case 'heart':
          this.toast('取得沉眠之心', 'big', 2.5);
          break;
        case 'wake':
          window.setTimeout(() => this.toast('地城甦醒了！帶著心回到入口石階', 'big', 3.5), 600);
          break;
        case 'rune':
          this.toast(`獲得 ${runeInfo(e.kind as RuneId).name}`, 'good', 2.5);
          break;
        case 'fullInventory':
        case 'dryFire':
        case 'barred':
        case 'needHeart':
        case 'doorBlocked':
          if (e.text) this.toast(e.text, '', 1.4);
          break;
        case 'resupply':
          this.toast('物資已補滿', 'good', 1.4);
          break;
        case 'chest':
          this.toast('寶箱已打開', 'good', 1.4);
          break;
        case 'bottleBreak':
          if (e.air) this.toast('空中擊破！', 'good', 1.4);
          break;
        case 'counter':
          this.toast(e.kind === 'charger' ? '反擊！衝鋒被擋下' : e.kind === 'guard' ? '反擊！盾衛失衡' : '反擊！', 'good', 1.4);
          break;
        case 'deflect':
          this.toast('擊開！', 'good', 1.2);
          break;
        case 'intercept':
          this.toast('截擊！弩矢被擊落', 'good', 1.4);
          break;
        case 'throw':
          if (e.kind === 'bottle' && p.cls === 'huntress')
            this.hint('cls-huntress-bottle', '獵手：瓶子還在空中時，按 2 拿弩、把準星對準它，出現「疾射」就左鍵——它會在你選的位置炸開。', 7);
          break;
        case 'enemyWindup':
          if (e.kind === 'archer') this.hint('archer', '紅線是弩手的瞄準線：線變亮代表已鎖定方向，側移就能躲開弩矢。');
          if (e.kind === 'charger') this.hint('charger', '突進者低頭蓄勢後會沿地上的橘線直線衝撞：閃開，讓它撞牆會暈眩。');
          if (e.kind === 'guard') this.hint('guard', '盾衛舉劍後，揮擊方向會鎖定：側移或後退就能躲開。');
          break;
        case 'hitEnemy':
          if (e.sneak) this.toast('背刺 ×3', 'good', 1.2);
          break;
        default:
      }
    }
  }

  update(w: World, r: GameRenderer, realDt: number): void {
    const p = w.player;
    this.set('cls', p.cls, () => {
      const info = classInfo(p.cls);
      this.badge.className = p.cls;
      this.badge.innerHTML = `${info.name}<small>${info.abilities
        .slice(0, 2)
        .map((a) => a.name)
        .join('・')}</small>`;
    });
    this.updateCue(w);
    // 生命
    this.set('hp', `${p.hp}/${p.maxHp}`, () => {
      this.hpEl.innerHTML = '';
      for (let k = 0; k < p.maxHp; k++) {
        const d = document.createElement('div');
        d.className = k < p.hp ? 'pip' : 'pip empty';
        this.hpEl.appendChild(d);
      }
    });
    // 目標
    this.set('obj', p.hasHeart ? 1 : w.level.practice ? 2 : 0, () => {
      this.objective.textContent = w.level.practice
        ? '操作練習：隨意嘗試。補給台可補滿物資，暫停選單可重置。'
        : p.hasHeart
          ? '目標：帶著沉眠之心回到入口石階'
          : '目標：深入地城，取得沉眠之心';
      this.objective.classList.toggle('escape', p.hasHeart);
      this.heartStatus.classList.toggle('hidden', !p.hasHeart);
    });
    this.set('runes', p.runes.join(','), () => {
      this.runesEl.innerHTML = p.runes.map((id) => `<span class="rune-chip">${runeInfo(id).name}</span>`).join('');
    });
    // 工具
    this.set('tool', `${p.tool}|${p.desiredTool}`, () => {
      for (const el of this.toolEls) {
        const t = el.dataset.tool;
        el.classList.toggle('current', t === p.tool);
        el.classList.toggle('pending', t === p.desiredTool && t !== p.tool);
      }
    });
    this.set('ammo', p.arrows, () => {
      this.ammo.textContent = String(p.arrows);
      this.ammo.classList.toggle('zero', p.arrows === 0);
    });
    this.set('bottles', p.bottles, () => {
      this.bottles.textContent = String(p.bottles);
      this.bottles.classList.toggle('zero', p.bottles === 0);
    });
    this.set('potions', p.potions, () => {
      this.potions.textContent = String(p.potions);
      this.potions.classList.toggle('zero', p.potions === 0);
    });
    // 時間流速
    const rate = w.lastRealDt > 0 ? w.lastWorldDt / w.lastRealDt : 0;
    const pct = Math.round(Math.min(1, rate) * 100);
    this.set('flow', pct, () => (this.flowFill.style.width = `${Math.max(6, pct)}%`));
    const label = p.action ? '行動中' : rate > 0.5 ? '時間流動' : '慢動作';
    this.set('flowLabel', label, () => (this.flowLabel.textContent = label));
    // 行動進度環
    const a = p.action;
    if (a) {
      const total = a.windup + a.active + a.recovery;
      const k = Math.min(1, a.t / total);
      const phase = a.t < a.windup ? 'windup' : a.t < a.windup + a.active ? 'active' : 'recovery';
      this.ring.style.strokeDashoffset = String(88 * (1 - k));
      this.set('ringPhase', phase, () => this.ring.setAttribute('class', `ring ${phase}`));
    } else
      this.set('ringPhase', 'none', () => {
        this.ring.style.strokeDashoffset = '88';
        this.ring.setAttribute('class', 'ring');
      });
    // 互動提示
    const t = w.interactTarget;
    const plabel = t ? t.label : '';
    this.set('prompt', plabel + (t?.enabled ? '1' : '0'), () => {
      this.prompt.textContent = plabel;
      this.prompt.classList.toggle('disabled', !!t && !t.enabled);
    });
    // 提示計時
    if (this.hintT > 0) {
      this.hintT -= realDt;
      if (this.hintT <= 0) {
        const next = this.hintQueue.shift();
        this.hintEl.textContent = next ? next.text : '';
        this.hintT = next ? next.dur : 0;
      }
    }
    // 受傷暗角
    this.vignT = Math.max(0, this.vignT - realDt);
    const lowHp = p.hp <= Math.max(3, p.maxHp * 0.3) && !p.dead ? 0.35 : 0;
    this.vignette.style.opacity = String(Math.max(lowHp, this.vignT * 1.2));
    this.updateIcons(w, r, realDt);
    this.updateTargets(w, r);
  }

  /** 準星旁的職業提示：提示出現＝現在按下去有效（與模擬層同一個判定）。 */
  private updateCue(w: World): void {
    const p = w.player;
    let cls = '';
    let text = '';
    if (!p.dead && !p.action) {
      if (p.cls === 'warrior' && w.cue.counter && p.tool === 'sword') {
        cls = 'counter';
        text = '反擊';
        this.hint('cls-warrior-counter', '戰士：敵人的攻擊鎖定、就在眼前時，準星下出現「反擊」——現在揮劍會更快出手並打斷它（弩矢會被打回去）。', 7);
      } else if (p.cls === 'warrior' && w.cue.counter) {
        cls = 'dim';
        text = '1 換劍：反擊';
      } else if (p.cls === 'huntress' && w.cue.quickTarget >= 0) {
        if (p.tool === 'crossbow' && p.arrows > 0) {
          cls = 'quick';
          text = '疾射';
        } else {
          cls = 'dim';
          text = p.arrows > 0 ? '2 換弩：疾射' : '沒有弩箭';
        }
      }
    }
    this.set('cue', `${cls}|${text}`, () => {
      this.cueEl.className = cls;
      this.cueEl.textContent = text;
      this.crosshair.classList.toggle('cue-counter', cls === 'counter');
      this.crosshair.classList.toggle('cue-quick', cls === 'quick');
    });
  }

  /** 獵手：標出射程內、看得到的可截擊飛行物；準星鎖定中的那一個會亮起。 */
  private updateTargets(w: World, r: GameRenderer): void {
    const p = w.player;
    const seen = new Set<number>();
    if (p.cls === 'huntress' && !p.dead) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const eye = { x: p.x, y: AIM_EYE_Y, z: p.z };
      for (const q of w.projectiles) {
        if (!interceptable(q)) continue;
        if (Math.hypot(q.pos.x - eye.x, q.pos.y - eye.y, q.pos.z - eye.z) > CLASSES.huntress.assistRange) continue;
        if (w.grid.segmentHit(eye, q.pos) !== null) continue;
        const pos = r.project(q.pos.x, q.pos.y, q.pos.z);
        if (!pos) continue;
        seen.add(q.id);
        let el = this.tmarks.get(q.id);
        if (!el) {
          el = document.createElement('div');
          this.targets.appendChild(el);
          this.tmarks.set(q.id, el);
        }
        el.className = `tmark ${q.kind}${w.cue.quickTarget === q.id ? ' hot' : ''}`;
        el.style.transform = `translate(${Math.round(pos.x * W)}px, ${Math.round(pos.y * H)}px)`;
      }
    }
    for (const [id, el] of this.tmarks) {
      if (seen.has(id)) continue;
      el.remove();
      this.tmarks.delete(id);
    }
  }

  private updateIcons(w: World, r: GameRenderer, realDt: number): void {
    const p = w.player;
    this.visT -= realDt;
    if (this.visT <= 0) {
      this.visT = 0.1;
      this.visible.clear();
      const eye = { x: p.x, y: PLAYER.eyeHeight, z: p.z };
      for (const e of w.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        if (d > 26) continue;
        const head = { x: e.x, y: e.y + e.height - 0.2, z: e.z };
        if (w.canSee(eye, head)) this.visible.add(e.id);
      }
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const e of w.enemies) {
      let el = this.iconEls.get(e.id);
      let cls = '';
      let text = '';
      if (e.alive && this.visible.has(e.id)) {
        if (e.state === 'sleep') {
          cls = 'sleep';
          text = 'Zz';
          this.hint('sleep', '睡著的敵人：從旁邊或背後用劍攻擊，造成 3 倍傷害。太靠近太久會吵醒它。');
        } else if (e.state === 'alert') {
          cls = 'alert';
          text = '!';
        } else if (e.state === 'search') {
          cls = 'search';
          text = '?';
        } else if (e.awareness > 0.02) {
          cls = 'aware';
          text = '?';
          this.hint('aware', '敵人頭上的圈填滿就會發現你：退出牠的視線，或用煙霧遮住。');
        }
      }
      if (!cls) {
        if (el) el.style.display = 'none';
        continue;
      }
      const pos = r.project(e.x, e.y + e.height + 0.45, e.z);
      if (!pos) {
        if (el) el.style.display = 'none';
        continue;
      }
      if (!el) {
        el = document.createElement('div');
        this.icons.appendChild(el);
        this.iconEls.set(e.id, el);
      }
      el.style.display = 'flex';
      el.className = `eicon ${cls}`;
      if (el.textContent !== text) el.textContent = text;
      if (cls === 'aware') el.style.setProperty('--p', `${Math.round(e.awareness * 100)}%`);
      el.style.transform = `translate(${Math.round(pos.x * W)}px, ${Math.round(pos.y * H)}px)`;
    }
  }

  toolName(t: keyof typeof TOOL_NAMES): string {
    return TOOL_NAMES[t];
  }
}
