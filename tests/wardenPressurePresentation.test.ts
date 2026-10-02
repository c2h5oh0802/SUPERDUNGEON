import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { ENEMIES, PLAYER } from '../src/config';
import { EnemyVisual, geometryCacheSize } from '../src/render/characters';
import { FxVisual } from '../src/render/fx';
import { createSharedUniforms } from '../src/render/materials';
import { counterThreat } from '../src/sim/classSys';
import { wardenBraced, wardenCrownClosed, wardenLockBefore, wardenWindup } from '../src/sim/enemySys';
import type { World } from '../src/sim/world';
import { Hud } from '../src/ui/hud';
import { makeWorld, OPEN_ROOM } from './helpers';

// CPU DOM/scene-graph contracts. These tests do not claim pixel, audio or device QA.
function presentationDom() {
  const elements = new Map<string, ReturnType<typeof element>>();
  function element() {
    const classes = new Set<string>();
    return {
      textContent: '', className: '', style: {} as Record<string, string>,
      classList: {
        toggle(name: string, force: boolean) { if (force) classes.add(name); else classes.delete(name); },
        contains(name: string) { return classes.has(name); },
      },
      setAttribute: vi.fn(),
    };
  }
  const get = (id: string) => {
    let el = elements.get(id);
    if (!el) { el = element(); elements.set(id, el); }
    return el;
  };
  vi.stubGlobal('document', {
    getElementById: get,
    createElement: () => ({ getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    }) }),
  });
  return get;
}

function bossFixture() {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'warden', x: 9.5, z: 6.5 }]);
  const e = w.enemies[0]!;
  e.state = 'alert'; e.phase = 'windup'; e.warden!.attack = 'cleave';
  w.encounterState = 'active';
  return { w, e };
}

function hudHooks(hud: Hud) {
  return hud as unknown as { updateBoss(w: World): void; updateCue(w: World): void };
}

function fxHooks(fx: FxVisual) {
  return fx as unknown as {
    updateTelegraphs(t: number): void;
    wedges: Map<number, THREE.Mesh>;
    wardenLanes: Map<number, THREE.Mesh>;
    aimLines: Map<number, THREE.Mesh>;
    geos: THREE.BufferGeometry[];
  };
}

function color(mesh: THREE.Mesh): number {
  return (mesh.material as THREE.MeshBasicMaterial).color.getHex();
}

afterEach(() => vi.unstubAllGlobals());

describe('Warden pressure presentation contracts', () => {
  it('names both cleaves and never offers a recovery opening between them', () => {
    const get = presentationDom(), hud = new Hud(), view = hudHooks(hud);
    const { w, e } = bossFixture();
    e.warden!.phaseTwo = true; e.warden!.cleavesLeft = 1;
    view.updateBoss(w);
    expect(get('boss-state').textContent).toContain('橫斬 1/2');
    expect(get('boss-state').textContent).toContain('可打斷');
    expect(get('boss-guide').textContent).toContain('第二斬後才收招');
    e.phase = 'active'; view.updateBoss(w);
    expect(get('boss-state').textContent).toContain('還有追斬');
    expect(get('boss-state').textContent).not.toContain('冠甲開啟');
    e.phase = 'windup'; e.warden!.followup = true; e.warden!.cleavesLeft = 0;
    view.updateBoss(w);
    expect(get('boss-state').textContent).toContain('追斬 2/2');
    expect(get('boss-state').textContent).toContain('準備中');
    expect(get('boss').classList.contains('exposed')).toBe(false);
    e.locked = true; view.updateBoss(w);
    expect(get('boss-state').textContent).toContain('方向已鎖定');
    e.phase = 'recovery'; view.updateBoss(w);
    expect(get('boss-state').textContent).toContain('收招');
    expect(get('boss-state').textContent).toContain('冠甲開啟，可追擊／射頭');
  });

  it('explains brace without concealing the earned exposed stagger or recovery', () => {
    const get = presentationDom(), view = hudHooks(new Hud());
    const { w, e } = bossFixture();
    e.warden!.braced = true;
    for (const phase of ['windup', 'stagger', 'recovery'] as const) {
      e.phase = phase; view.updateBoss(w);
      expect(get('boss-state').textContent).toContain('穩勢：抗打斷');
      expect(get('boss-guide').textContent).toContain('穩勢不減傷');
      expect(get('boss-guide').textContent).toContain('完成攻擊與收招後解除');
      expect(get('boss').classList.contains('exposed')).toBe(!wardenCrownClosed(e));
      if (phase !== 'windup') expect(get('boss-state').textContent).toContain('冠甲開啟，可追擊／射頭');
    }
    e.warden!.braced = false; e.phase = 'windup'; view.updateBoss(w);
    expect(get('boss-state').textContent).toContain('可打斷');
    expect(get('boss-state').textContent).not.toContain('穩勢');
    expect(get('boss-guide').textContent).toContain('鬆開再按');
    expect(get('boss').classList.contains('braced')).toBe(false);
  });

  it('uses the actual Counter predicate and gives only Boss cues a fresh-press instruction', () => {
    const get = presentationDom(), hud = new Hud(), view = hudHooks(hud);
    const { w, e } = bossFixture();
    w.player.x = e.x; w.player.z = e.z + 2; w.player.yaw = 0;
    e.yaw = e.lockedYaw = Math.PI; e.locked = true;
    e.phaseT = wardenWindup(e) - wardenLockBefore(e);
    w.cue.counter = counterThreat(w);
    expect(w.cue.counter?.kind).toBe('warden');
    view.updateCue(w);
    expect(get('cue').textContent).toBe('反擊：鬆開再按');
    expect(get('hint').textContent).toContain('長按只會普通攻擊');
    hud.setTouchMode(true); view.updateCue(w);
    expect(get('cue').textContent).toBe('反擊：鬆開再按');
    w.player.tool = 'stone'; view.updateCue(w);
    expect(get('cue').textContent).toBe('點近戰武器：鬆開再按反擊');
    e.warden!.braced = true; w.cue.counter = counterThreat(w);
    expect(w.cue.counter).toBeNull(); view.updateCue(w);
    expect(get('cue').textContent).toBe('');
    w.player.tool = 'melee'; w.cue.counter = { kind: 'guard', id: e.id };
    view.updateCue(w); expect(get('cue').textContent).toBe('反擊');
    w.cue.counter = { kind: 'bolt', id: e.id };
    view.updateCue(w); expect(get('cue').textContent).toBe('反擊');
  });

  it('briefs both classes about visible brace and the two-hit sequence at first engagement', () => {
    for (const cls of ['warrior', 'huntress'] as const) {
      const get = presentationDom(), hud = new Hud();
      const w = makeWorld(OPEN_ROOM, [], cls);
      hud.onEvents([{ type: 'enemyWindup', id: 1, kind: 'warden' }], w);
      expect(get('hint').textContent).toContain('紫紅穩勢只抗打斷、不減傷');
      expect(get('hint').textContent).toContain('第二階段連斬兩次');
      if (cls === 'warrior') expect(get('hint').textContent).toContain('鬆開再按攻擊');
      else expect(get('hint').textContent).toContain('側移閃開');
    }
  });

  it('describes resisted collisions without falsely announcing an earned stagger', () => {
    presentationDom();
    const hud = new Hud(), toast = vi.spyOn(hud, 'toast').mockImplementation(() => {});
    const { w } = bossFixture();
    for (const kind of ['wall', 'ally']) {
      const text = kind === 'wall' ? '撞牆，守心者穩勢未被打斷' : '碰撞，守心者穩勢未被打斷';
      hud.onEvents([{ type: 'bump', id: 1, kind, text }], w);
      expect(toast).toHaveBeenLastCalledWith(text, '', 1.3);
    }
    hud.onEvents([{ type: 'bump', id: 2, kind: 'wall' }], w);
    expect(toast).toHaveBeenLastCalledWith('撞牆！失衡', 'good', 1.3);
  });

  it('uses each move’s full windup and lock timing while visibly winding back for the follow-up', () => {
    const { e } = bossFixture(), vis = new EnemyVisual(e, createSharedUniforms());
    try {
      let firstArm = 0;
      for (const followup of [false, true]) {
        e.warden!.followup = followup;
        e.phaseT = wardenWindup(e) / 2; e.locked = false;
        vis.update(e, 1 / 60);
        if (!followup) firstArm = vis.joints.armL.rotation.x;
        else expect(vis.joints.armL.rotation.x).toBeCloseTo(firstArm, 8);
        expect(Math.sign(vis.joints.torso.rotation.y)).toBe(followup ? 1 : -1);
        e.phaseT = wardenWindup(e) - wardenLockBefore(e);
        vis.update(e, 1 / 60);
        const preLockGlow = vis.mat.uniforms.uGlowAmt!.value as number;
        e.locked = true; vis.update(e, 1 / 60);
        expect(vis.mat.uniforms.uGlowAmt!.value).toBeCloseTo(1.05, 8);
        expect(vis.mat.uniforms.uGlowAmt!.value).toBeGreaterThan(preLockGlow);
      }
    } finally { vis.dispose(); }
  });

  it('makes brace visible in stance/tint but preserves exposed pose, crown and status tints', () => {
    const { e } = bossFixture(), vis = new EnemyVisual(e, createSharedUniforms());
    try {
      e.phaseT = .3; vis.update(e, 1 / 60);
      const normalHips = vis.joints.hips.position.y, normalTint = vis.rig.uTint.value.getHex();
      e.warden!.braced = true; vis.update(e, 1 / 60);
      expect(vis.joints.hips.position.y).toBeLessThan(normalHips);
      expect(vis.rig.uTint.value.getHex()).not.toBe(normalTint);
      expect(vis.eyeMat.color.getHex()).toBe(0xff75d0);
      for (const phase of ['stagger', 'recovery'] as const) {
        e.phase = phase; vis.update(e, 1 / 60);
        const earnedPose = vis.joints.hips.position.y;
        expect(wardenBraced(e)).toBe(true);
        expect(vis.crown.every(panel => panel.rotation.z !== 0)).toBe(true);
        expect(vis.eyeMat.color.getHex()).toBe(0x9bf7e8);
        expect(vis.rig.uTint.value.getHex()).toBe(0x9bf7e8);
        e.warden!.braced = false; vis.update(e, 1 / 60);
        expect(vis.joints.hips.position.y).toBe(earnedPose);
        e.warden!.braced = true;
      }
      e.phase = 'windup'; e.paralyzeT = 1; vis.update(e, 1 / 60);
      expect(vis.rig.uTint.value.getHex()).toBe(0xb07cff);
      e.paralyzeT = 0; e.slowT = 1; vis.update(e, 1 / 60);
      expect(vis.rig.uTint.value.getHex()).toBe(0x6cc4ff);
    } finally { vis.dispose(); }
  });

  it('changes pressure colors without changing wedge bounds, locked direction or allocating new geometry', () => {
    presentationDom();
    const { w, e } = bossFixture(), fx = new FxVisual(w), graph = fxHooks(fx);
    try {
      e.locked = true; e.lockedYaw = 1; e.yaw = 2;
      graph.updateTelegraphs(1);
      const wedge = graph.wedges.get(e.id)!, geometry = wedge.geometry, size = graph.geos.length;
      const firstColor = color(wedge);
      const positions = geometry.getAttribute('position');
      let maxR = 0;
      for (let i = 0; i < positions.count; i++) maxR = Math.max(maxR, Math.hypot(positions.getX(i), positions.getZ(i)));
      expect(maxR).toBeCloseTo(ENEMIES.warden.cleaveReach + PLAYER.radius, 5);
      e.warden!.followup = true; graph.updateTelegraphs(1);
      expect(color(wedge)).not.toBe(firstColor);
      const followupColor = color(wedge);
      e.warden!.braced = true; graph.updateTelegraphs(1);
      expect(color(wedge)).not.toBe(followupColor);
      expect(color(wedge)).toBe(0xff46ab);
      for (const braced of [false, true]) for (const followup of [false, true]) {
        e.warden!.braced = braced; e.warden!.followup = followup;
        for (const phase of ['windup', 'active', 'stagger', 'recovery'] as const) {
          e.phase = phase; graph.updateTelegraphs(1);
          expect(wedge.geometry).toBe(geometry);
          expect(graph.geos.length).toBe(size);
          expect(wedge.rotation.y).toBe(e.lockedYaw);
          expect(wedge.visible).toBe(phase === 'windup' || phase === 'active');
        }
      }
    } finally { fx.dispose(); }
  });

  it('keeps braced lance/rush warnings aligned and clears them during earned openings', () => {
    presentationDom();
    const { w, e } = bossFixture(), fx = new FxVisual(w), graph = fxHooks(fx);
    try {
      e.warden!.braced = true; e.locked = true; e.lockedYaw = 0;
      e.warden!.attack = 'lance'; e.phase = 'aim';
      e.aimPoint = { x: e.x, y: ENEMIES.warden.lanceHeight, z: e.z - 5 };
      graph.updateTelegraphs(1);
      const line = graph.aimLines.get(e.id)!, lane = graph.wardenLanes.get(e.id)!;
      expect(color(line)).toBe(0xff46ab); expect(color(lane)).toBe(color(line));
      expect(lane.scale.x).toBe(2 * (ENEMIES.warden.lanceRadius + PLAYER.radius));
      e.warden!.attack = 'rush'; e.phase = 'charge'; e.chargeDist = 2;
      graph.updateTelegraphs(1);
      expect(line.visible).toBe(false); expect(lane.visible).toBe(true);
      expect(color(lane)).toBe(0xff46ab); expect(lane.rotation.y).toBe(e.lockedYaw);
      expect(lane.scale.z).toBe(ENEMIES.warden.rushDist - 2 + 2 * (e.radius + PLAYER.radius));
      e.phase = 'recovery'; graph.updateTelegraphs(1);
      expect(line.visible).toBe(false); expect(lane.visible).toBe(false);
    } finally { fx.dispose(); }
  });

  it('retains finite poses and the shared geometry cache through repeated pressure states', () => {
    const { e } = bossFixture(), vis = new EnemyVisual(e, createSharedUniforms());
    try {
      const size = geometryCacheSize();
      for (const braced of [false, true]) for (const followup of [false, true]) {
        e.warden!.braced = braced; e.warden!.followup = followup;
        for (const phase of ['none', 'windup', 'active', 'recovery', 'stagger'] as const) {
          e.phase = phase; e.phaseT = .4; vis.update(e, 1 / 60); vis.root.updateMatrixWorld(true);
          expect(vis.crown.every(panel => panel.rotation.z === 0)).toBe(wardenCrownClosed(e));
          vis.root.traverse(object => object.matrixWorld.elements.forEach(value => expect(Number.isFinite(value)).toBe(true)));
          expect(geometryCacheSize()).toBe(size);
        }
      }
      e.alive = false; vis.update(e, 1 / 60);
      expect(vis.eyes.visible).toBe(false); expect(vis.rig.uTintAmt.value).toBe(0);
      expect(vis.crown.every(panel => panel.rotation.z !== 0)).toBe(true);
    } finally { vis.dispose(); }
  });
});
