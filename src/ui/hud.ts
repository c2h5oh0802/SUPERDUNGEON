import { trialInfo } from '../gen/practiceTrials';
import { ARMORS, HUNGER, PLAYER, RUN, TALENT_FX, XP, TIP_NAMES, TOOL_NAMES, WEAPONS, classInfo, type TipKind, type Tool } from '../config';
import { knownHealingCount } from '../sim/items';
import { HUNGER_NAMES, hungerState } from '../sim/hunger';
import { hasTalent, nextLevelXp } from '../sim/progress';
import { wardenCrownClosed } from '../sim/enemySys';
import { angleDiff, dirFromYawPitch, yawFromDir } from '../core/math';
import type { GameRenderer } from '../render/renderer';
import type { GameEvent, Player } from '../sim/types';
import type { World } from '../sim/world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 工具列一格的數量文字。 */
function toolCount(p: Player, t: Tool): string {
  switch (t) {
    case 'bow':
      return String(p.arrows);
    case 'stone':
      return String(p.stones);
    case 'tipped':
      return `${p.tipped.paralysis}/${p.tipped.chill}`;
    default:
      return '';
  }
}

function toolEmpty(p: Player, t: Tool): boolean {
  if (t === 'bow') return p.arrows === 0;
  if (t === 'stone') return p.stones === 0;
  if (t === 'tipped') return p.tipped.paralysis + p.tipped.chill === 0;
  return false;
}

export class Hud {
  private root = $('hud');
  private hpEl = $('hp');
  private hungerEl = $('hunger');
  private hungerLabel = $('hunger-label');
  private hungerFill = $('hunger-fill');
  private objective = $('objective');
  private bossEl = $('boss');
  private bossName = $('boss-name');
  private bossHealth = $('boss-health');
  private bossFill = $('boss-fill');
  private bossState = $('boss-state');
  private flowFill = $('flow-fill');
  private flowLabel = $('flow-label');
  private ring = document.getElementById('action-ring') as unknown as SVGCircleElement;
  private prompt = $('prompt');
  private toasts = $('toasts');
  private hintEl = $('hint');
  private heartStatus = $('heart-status');
  private toolsEl = $('tools');
  private xpLevel = $('xp-level');
  private xpFill = $('xp-fill');
  private buffsEl = $('buffs');
  private stealthEl = $('stealth');
  private bag = $('bag');
  private armorEl = $('armor');
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
  private toolEls: HTMLElement[] = [];
  private iconEls = new Map<number, HTMLDivElement>();
  private soundEls = new Map<number, { el: HTMLDivElement; expiresAt: number }>();
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
    for (const { el } of this.soundEls.values()) el.remove();
    this.soundEls.clear();
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
    this.bossEl.classList.add('hidden');
    this.root.classList.remove('warden-present');
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
        case 'pickup':
          this.toast(e.kind === 'item' ? `撿到 ${e.text ?? ''}` : `+${e.amount} ${e.text ?? ''}`, 'good', 1.6);
          if (e.kind === 'item') this.hint('bag', '撿到物品了：按 I 打開背包（世界暫停），可以使用、裝備或放下物品。', 7);
          break;
        case 'hungerState':
          if (e.text) this.toast(e.text, e.kind === 'normal' ? 'good' : 'bad', 3);
          break;
        case 'eat':
          // 狀態轉換已有提示；仍在同一狀態時也確認吃下的結果。
          this.toast('吃下乾糧，飢餓減少', 'good', 1.8);
          break;
        case 'identify':
        case 'dropItem':
        case 'equip':
        case 'buff':
          if (e.text) this.toast(e.text, 'good', 2.2);
          break;
        case 'levelUp':
          this.toast(`升到第 ${e.amount} 級！最大生命 +${XP.hpPerLevel}`, 'big', 2.5);
          break;
        case 'read':
          if (e.kind === 'mapping') this.toast('整層地圖都揭開了（Tab）', 'good', 2);
          if (e.kind === 'sleep') this.toast('附近敵人陷入沉睡；已鎖定的攻擊仍會完成', 'big', 2);
          if (e.kind === 'teleport') this.toast('你被傳送到別的地方', 'good', 2);
          break;
        case 'shatter':
          if (e.text) this.toast(e.text, '', 1.6);
          break;
        case 'corpseFound':
          this.toast('有敵人發現了屍體！', 'bad', 2);
          break;
        case 'alarm':
          this.hint('alarm', '整層進入戒備：敵人視野更廣、發現你更快、搜索更久。下次在看不到的地方下手。', 7);
          break;
        case 'suspicious':
          this.hint('step', '敵人聽到了聲音（頭上的 ?）。正常走路有腳步聲，按住 Shift 潛行步就不會出聲。', 7);
          break;
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
        case 'descend':
          this.toast(`往下走……第 ${e.amount} 層`, 'big', 2);
          break;
        case 'wake':
          this.toast('地城甦醒了', 'big', 3.5);
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
          this.toast(e.kind === 'charger' ? '反擊！衝鋒被擋下' : e.kind === 'guard' ? '反擊！盾衛失衡' : e.kind === 'warden' ? '反擊！守心者失衡，冠甲開啟' : '反擊！', 'good', 1.4);
          break;
        case 'deflect':
          this.toast('擊開！', 'good', 1.2);
          break;
        case 'block':
          this.toast(e.kind === 'charger' ? '擋下衝撞！' : e.kind === 'bolt' ? '盾擋下弩矢' : '盾擋下攻擊', 'good', 1.3);
          break;
        case 'bump':
          if (e.kind === 'wall') this.toast('撞牆！失衡', 'good', 1.3);
          else if (e.kind === 'ally') this.toast('撞在一起！踉蹌', 'good', 1.3);
          else this.toast('突進者撞到同伴！', 'good', 1.3);
          break;
        case 'tipHit':
          this.toast(e.kind === 'paralysis' ? '麻痺！時間軸暫停' : '冰寒！時間軸變慢', 'good', 1.4);
          break;
        case 'shield':
          if (p.cls === 'huntress')
            this.hint('cls-huntress-shield', '盾衛看到你拿著弓就舉盾前進：等它舉劍或收招的那一刻射頭，或繞到側面。', 7);
          break;
        case 'helmet':
          if (e.kind === 'warden') {
            this.toast('冠甲擋住了：改打身體或繞側', '', 1.5);
          } else {
            this.toast('角盔擋住了', '', 1.2);
            this.hint('cls-helmet', '突進者的角盔擋住正面的頭：閃過衝鋒、讓它撞牆暈眩，頭就會露出來。', 7);
          }
          break;
        case 'toolSwitch':
          if (e.kind === 'tipped') {
            this.toast(`藥劑箭：${TIP_NAMES[p.tipKind]}（再按 3 切換）`, '', 1.4);
          }
          break;
        case 'throw':
          if (e.kind === 'bottle' && p.cls === 'huntress')
            this.hint('cls-huntress-bottle', '獵人之眼：瓶子還在空中時拿著弓，準星對準菱形標記、出現「放箭」就左鍵——它會在空中炸開。地上的圈是它的落點。', 8);
          break;
        case 'enemyWindup':
          if (e.kind === 'archer') this.hint('archer', '紅線是弩手的瞄準線：線變亮代表已鎖定方向，側移就能躲開弩矢。');
          if (e.kind === 'charger') this.hint('charger', '突進者低頭蓄勢後會沿地上的橘線直線衝撞：閃開，讓它撞牆會暈眩。');
          if (e.kind === 'warden') this.hint('warden-lock', '守心者的攻擊變亮後鎖定方向：側移離開扇形或直線；收招與失衡時，冠甲會打開。', 7);
          if (e.kind === 'guard') this.hint('guard', '盾衛舉劍後，揮擊方向會鎖定：側移或後退就能躲開。');
          break;
        case 'hitEnemy':
          if (e.sneak) this.toast('奇襲：取得先手', 'good', 1.2);
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
      this.badge.innerHTML = `${info.name}<small>${info.loadout.map((l) => l.name).join('・')}</small>`;
      this.buildTools(p);
    });
    this.updateBoss(w);
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
    // 飢餓緊鄰生命，進度是往瀕餓累積（不是另一份飽食資源）。
    const hs = hungerState(p.hunger);
    const hpct = Math.floor(100 * p.hunger / HUNGER.starvingAt);
    const food = p.items.find((it) => it.id === 'food:ration')?.count ?? 0;
    this.set('hunger', `${hs}|${hpct}|${food}|${w.hungerPaused}`, () => {
      this.hungerEl.className = hs;
      this.hungerLabel.textContent = `飢餓：${HUNGER_NAMES[hs]} ${hpct}%${w.hungerPaused ? '（首領戰暫停）' : ''} · 乾糧 ${food}（I）`;
      this.hungerFill.style.width = `${hpct}%`;
      this.hungerEl.title = `飢餓只隨世界時間增加；${HUNGER.hungryAt} 秒提醒，${HUNGER.starvingAt} 秒瀕餓，每 ${HUNGER.damageEvery} 秒損失 1 生命`;
    });
    // 目標
    const trial = w.level.practiceTrial ? trialInfo(w.level.practiceTrial) : null;
    const trialDone = trial && (trial.id === 'heart-warden' ? p.hasHeart : trial.id === 'cluster-bypass' ? w.stats.chests > 0 : w.enemies.every(e => !e.alive));
    const trialGoal = trial?.id === 'heart-warden' && w.encounterState === 'resolved' && !p.hasHeart
      ? '守心者已倒下：按 E 取走沉眠之心。' : trial?.objective;
    this.set('obj', `${p.hasHeart}|${w.level.practice}|${w.level.floor}|${w.level.goal}|${w.encounterState}|${trial?.id}|${trialDone}`, () => {
      const f = `第 ${w.level.floor} / ${RUN.floors} 層`;
      this.objective.textContent = trial
        ? `${trial.name}：${trialDone ? '目標完成；Esc 可重置比較另一種方法。' : trialGoal + ' Esc 可重置。'}`
        : w.level.practice
        ? '操作練習：隨意嘗試。補給台可補滿物資，暫停選單可重置。'
        : w.level.goal === 'descend'
          ? `${f}：找到往下的階梯`
          : `${f}（首領層）：${w.heartAvailable ? '取得沉眠之心' : '擊倒守心者，解封沉眠之心'}`;
      this.objective.classList.toggle('escape', p.hasHeart);
      this.heartStatus.classList.toggle('hidden', !p.hasHeart);
    });
    // 工具
    this.set('tool', `${p.tool}|${p.desiredTool}`, () => {
      for (const el of this.toolEls) {
        const t = el.dataset.tool;
        el.classList.toggle('current', t === p.tool);
        el.classList.toggle('pending', t === p.desiredTool && t !== p.tool);
      }
    });
    this.set('gear', `${p.weapon.id}${p.weapon.level}|${p.armor.id}${p.armor.level}|${p.shieldLevel}`, () => {
      for (const el of this.toolEls) {
        const span = el.querySelector('span')!;
        if (el.dataset.tool === 'melee') span.textContent = `${WEAPONS[p.weapon.id].name}${p.weapon.level ? ` +${p.weapon.level}` : ''}`;
        if (el.dataset.tool === 'shield') span.textContent = '推擊';
      }
      this.armorEl.textContent = p.armor.id === 'cloth' ? '' : `${ARMORS[p.armor.id].name}${p.armor.level ? ` +${p.armor.level}` : ''}`;
    });
    this.set('ammo', `${p.arrows}|${p.stones}|${p.tipped.paralysis}|${p.tipped.chill}|${p.tipKind}`, () => {
      for (const el of this.toolEls) {
        const t = el.dataset.tool as Tool | 'shield';
        if (t === 'shield') continue;
        const em = el.querySelector('em');
        if (em) {
          em.textContent = toolCount(p, t);
          em.classList.toggle('zero', toolEmpty(p, t));
        }
        if (t === 'tipped') el.querySelector('span')!.textContent = TIP_NAMES[p.tipKind as TipKind];
        if (t === 'bow' && p.bowLevel) el.querySelector('span')!.textContent = `獵弓 +${p.bowLevel}`;
      }
    });
    this.set('bottles', p.bottles, () => {
      this.bottles.textContent = String(p.bottles);
      this.bottles.classList.toggle('zero', p.bottles === 0);
    });
    const healing = knownHealingCount(w);
    this.set('potions', healing, () => {
      this.potions.textContent = String(healing);
      this.potions.classList.toggle('zero', healing === 0);
    });
    this.set('bag', p.items.length, () => (this.bag.textContent = String(p.items.length)));
    // 等級與經驗
    this.set('xp', `${p.level}|${p.xp}`, () => {
      const cur = XP.levels[p.level - 1] ?? 0;
      const next = nextLevelXp(p.level);
      this.xpLevel.textContent = `Lv ${p.level}`;
      this.xpFill.style.width = next === null ? '100%' : `${Math.round(((p.xp - cur) / (next - cur)) * 100)}%`;
    });
    // 增益
    const buffs = [p.invisT > 0 ? `隱形 ${p.invisT.toFixed(1)}` : '', p.hasteT > 0 ? `迅捷 ${p.hasteT.toFixed(1)}` : '', p.comboT > 0 ? '連擊' : '']
      .filter(Boolean)
      .map((b) => `<span>${b}</span>`)
      .join('');
    this.set('buffs', buffs, () => (this.buffsEl.innerHTML = buffs));
    // 腳步聲：潛行／正常（會被聽到）；戒備中
    const moving = p.lastMoveDist > 0;
    const st = p.sneaking ? 'sneak' : moving ? 'loud' : '';
    this.set('stealth', `${st}|${w.alarm}`, () => {
      this.stealthEl.className = `${st}${w.alarm ? ' alarm' : ''}`;
      this.stealthEl.textContent = p.sneaking ? '潛行步：安靜' : moving ? '腳步聲（Shift 安靜慢走）' : '靜止';
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
    this.updateSenses(w);
    this.updateTargets(w, r);
  }

  private updateBoss(w: World): void {
    const boss = w.enemies.find(e => e.kind === 'warden' && e.alive);
    this.set('boss-visible', !!boss, () => {
      this.bossEl.classList.toggle('hidden', !boss);
      this.root.classList.toggle('warden-present', !!boss);
    });
    if (!boss) return;
    const phaseTwo = !!boss.warden?.phaseTwo;
    const closed = wardenCrownClosed(boss);
    const attack = boss.warden?.attack;
    const action = boss.phase === 'stagger' ? '失衡' : boss.phase === 'recovery' ? '收招' :
      boss.phase === 'charge' ? '衝撞中' : boss.phase === 'active' ? '斬擊中' :
      boss.phase === 'windup' || boss.phase === 'aim'
        ? `${attack === 'cleave' ? '橫斬' : attack === 'lance' ? '槍矢' : '衝撞'}・${boss.locked ? '方向已鎖定' : '準備中'}`
        : w.encounterState === 'dormant' ? '尚未開戰' : '逼近中';
    this.set('boss-hp', `${boss.hp}|${boss.maxHp}`, () => {
      const hp = Math.max(0, boss.hp);
      this.bossHealth.textContent = `${hp} / ${boss.maxHp}`;
      this.bossFill.style.width = `${Math.min(100, 100 * hp / boss.maxHp)}%`;
      this.bossEl.setAttribute('aria-label', `守心者，生命 ${hp} / ${boss.maxHp}`);
    });
    this.set('boss-state', `${action}|${closed}|${phaseTwo}`, () => {
      this.bossName.textContent = phaseTwo ? '守心者 · 第二階段' : '守心者';
      this.bossEl.classList.toggle('exposed', !closed);
      this.bossEl.classList.toggle('phase-two', phaseTwo);
      this.bossState.textContent = `${action} · ${closed ? '冠甲閉合' : '冠甲開啟，可射頭'}`;
    });
  }

  /** 依職業建立工具列：數字鍵對應的武器（與模擬層的 slots 相同），戰士另有推擊。 */
  private buildTools(p: Player): void {
    const cells = p.slots.map(
      (t, k) => `<div class="tool" data-tool="${t}"><kbd>${k + 1}</kbd><span>${TOOL_NAMES[t]}</span>${t === 'melee' ? '' : '<em></em>'}</div>`,
    );
    if (p.cls === 'warrior') cells.push('<div class="tool shield" data-tool="shield"><kbd>右鍵/F</kbd><span>推擊</span></div>');
    this.toolsEl.innerHTML = cells.join('');
    this.toolEls = Array.from(this.toolsEl.querySelectorAll<HTMLElement>('.tool'));
    delete this.last.tool;
    delete this.last.ammo;
    delete this.last.gear;
  }

  /** 準星旁的職業提示：提示出現＝現在按下去有效（與模擬層同一個判定）。 */
  private updateCue(w: World): void {
    const p = w.player;
    let cls = '';
    let text = '';
    if (!p.dead && !p.action) {
      if (p.cls === 'warrior' && w.cue.counter && p.tool === 'melee') {
        cls = 'counter';
        text = '反擊';
        this.hint('cls-warrior-counter', '戰士：敵人的攻擊鎖定、就在眼前時，準星下出現「反擊」——現在揮劍會更快出手並打斷它（弩矢會被打回去）。', 7);
      } else if (p.cls === 'warrior' && w.cue.counter) {
        cls = 'dim';
        text = '1 換劍：反擊';
      } else if (p.cls === 'warrior' && w.cue.push >= 0) {
        cls = 'push';
        text = '推擊';
        this.hint('cls-warrior-push', '戰士：敵人就在身前時出現「推擊」——右鍵或 F 近身推退 1 m，不格擋、不自動打斷：撞牆會失衡、撞到同伴會一起踉蹌。', 7);
      } else if (p.cls === 'huntress' && this.onLead(w)) {
        cls = 'quick';
        text = '放箭';
      }
    }
    this.set('cue', `${cls}|${text}`, () => {
      this.cueEl.className = cls;
      this.cueEl.textContent = text;
      this.crosshair.classList.toggle('cue-counter', cls === 'counter' || cls === 'push');
      this.crosshair.classList.toggle('cue-quick', cls === 'quick');
    });
  }

  /** 準星是否已經對在獵人之眼的提前量標記上（容許誤差＝箭與瓶子的交會半徑）。 */
  private onLead(w: World): boolean {
    const p = w.player;
    const view = dirFromYawPitch(p.yaw, p.pitch);
    for (const e of w.cue.eye) {
      if (!e.aim || !e.meet) continue;
      const d = Math.hypot(e.meet.x - p.x, e.meet.y - PLAYER.eyeHeight, e.meet.z - p.z);
      const tol = Math.atan2(0.15, Math.max(1, d));
      const a = dirFromYawPitch(e.aim.yaw, e.aim.pitch);
      const cos = view.x * a.x + view.y * a.y + view.z * a.z;
      if (Math.acos(Math.min(1, cos)) <= tol) return true;
    }
    return false;
  }

  /** 獵人之眼：空中煙霧瓶的提前量標記（菱形）；落點圈由特效層畫在地上。 */
  private updateTargets(w: World, r: GameRenderer): void {
    const p = w.player;
    const seen = new Set<number>();
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const e of w.cue.eye) {
      if (!e.aim) continue;
      const d = dirFromYawPitch(e.aim.yaw, e.aim.pitch);
      const pos = r.project(p.x + d.x * 40, PLAYER.eyeHeight + d.y * 40, p.z + d.z * 40);
      if (!pos) continue;
      seen.add(e.id);
      let el = this.tmarks.get(e.id);
      if (!el) {
        el = document.createElement('div');
        this.targets.appendChild(el);
        this.tmarks.set(e.id, el);
      }
      el.className = 'tmark lead';
      // 菱形：先平移再旋轉（旋轉放在平移前面會連位移一起轉掉）
      el.style.transform = `translate(${Math.round(pos.x * W)}px, ${Math.round(pos.y * H)}px) rotate(45deg)`;
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
          this.hint('sleep', '睡著的敵人：近戰奇襲讓它踉蹌；獵刀另有雙倍傷害。聲音或靠近太久會吵醒它。');
        } else if (e.state === 'alert') {
          cls = 'alert';
          text = '!';
        } else if (e.state === 'search' || e.state === 'investigate') {
          cls = 'search';
          text = e.state === 'investigate' ? '?' : '…';
        } else if (e.awareness > 0.02) {
          cls = 'aware';
          text = '?';
          this.hint('aware', '敵人頭上的圈填滿就會發現你：退出牠的視線，或用煙霧遮住。');
        }
        // Marks belong to a visible target, never a global buff or a through-wall marker.
        if ((e.huntingMarkUntil ?? 0) > w.time) {
          cls = `${cls} marked`.trim();
          text += '◇';
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
      el.className = `eicon ${cls}${e.veteran ? ' vet' : ''}`;
      if (el.textContent !== text) el.textContent = text;
      if (cls.startsWith('aware')) el.style.setProperty('--p', `${Math.round(e.awareness * 100)}%`);
      el.style.transform = `translate(${Math.round(pos.x * W)}px, ${Math.round(pos.y * H)}px)`;
    }
  }

  /** Sound memories sit at eight fixed HUD bearings; never project an enemy's position. */
  private updateSenses(w: World): void {
    const seen = new Set<number>();
    const directions = ['前方', '左前方', '左方', '左後方', '後方', '右後方', '右方', '右前方'];
    if (w.player.cls === 'huntress' && !w.player.dead && hasTalent(w.player, 'senses')) {
      for (const cue of w.senses) {
        if (cue.expiresAt <= w.realTime) continue;
        seen.add(cue.sector);
        const previous = this.soundEls.get(cue.sector);
        if (previous?.expiresAt === cue.expiresAt) continue;
        previous?.el.remove();
        const el = document.createElement('div');
        el.className = 'sense-cue';
        el.textContent = `${directions[cue.sector]}聲響`;
        const angle = cue.sector * Math.PI * 2 / TALENT_FX.sensesSectors;
        el.style.left = `calc(50% + ${Math.round(-Math.sin(angle) * 145)}px)`;
        el.style.top = `calc(50% + ${Math.round(-Math.cos(angle) * 100)}px)`;
        // CSS uses wall-clock time, so pausing cannot leave a stale cue visible indefinitely.
        el.style.animationDuration = `${Math.min(TALENT_FX.sensesCueSeconds, cue.expiresAt - w.realTime)}s`;
        this.icons.appendChild(el);
        this.soundEls.set(cue.sector, { el, expiresAt: cue.expiresAt });
      }
    }
    for (const [sector, { el }] of this.soundEls) {
      if (seen.has(sector)) continue;
      el.remove();
      this.soundEls.delete(sector);
    }
  }

}
