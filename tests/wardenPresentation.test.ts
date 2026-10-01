import { describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { ENEMIES, PLAYER } from '../src/config';
import { EnemyVisual, geometryCacheSize } from '../src/render/characters';
import { FxVisual } from '../src/render/fx';
import { createSharedUniforms } from '../src/render/materials';
import { wardenCrownClosed } from '../src/sim/enemySys';
import { makeWorld, OPEN_ROOM } from './helpers';

// CPU scene-graph contracts only. This does not render pixels or verify audio.
describe('Warden presentation state contracts', () => {
  it('keeps crown state, finite poses and cached geometry consistent across all phases', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'warden', x: 9.5, z: 6.5 }]), e = w.enemies[0]!;
    e.state = 'alert';
    const vis = new EnemyVisual(e, createSharedUniforms());
    expect(vis.crown).toHaveLength(2);
    for (const attack of ['cleave', 'lance', 'rush'] as const) for (const phase of ['none', 'windup', 'aim', 'active', 'charge', 'recovery', 'stagger'] as const) {
      e.warden!.attack = attack; e.phase = phase; e.phaseT = .4;
      vis.update(e, 1 / 60); vis.root.updateMatrixWorld(true);
      expect(vis.crown.every(p => p.rotation.z === 0)).toBe(wardenCrownClosed(e));
      vis.root.traverse(o => { for (const value of o.matrixWorld.elements) expect(Number.isFinite(value)).toBe(true); });
    }
    const before = geometryCacheSize(), second = new EnemyVisual(e, createSharedUniforms());
    expect(geometryCacheSize()).toBe(before);
    e.alive = false; vis.update(e, 1 / 60);
    expect(vis.eyes.visible).toBe(false); expect(vis.crown.every(p => p.rotation.z !== 0)).toBe(true);
    vis.dispose(); second.dispose();
  });

  it('uses locked directions and player-inclusive hit extents, then clears warnings', () => {
    // Stub only texture-allocation canvas; no fake renderer or visual pass claim.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    }) }) });
    const w = makeWorld(OPEN_ROOM, [{ kind: 'warden', x: 9.5, z: 6.5 }]), e = w.enemies[0]!;
    const fx = new FxVisual(w);
    // Inspection is intentionally limited to the scene objects generated from state.
    const graph = fx as unknown as { updateTelegraphs(t: number): void; wedges: Map<number, THREE.Mesh>; wardenLanes: Map<number, THREE.Mesh>; aimLines: Map<number, THREE.Mesh> };
    try {
      e.state = 'alert'; e.warden!.attack = 'cleave'; e.phase = 'windup'; e.locked = true; e.lockedYaw = 1; e.yaw = 2; e.phaseT = .7;
      graph.updateTelegraphs(1);
      const wedge = graph.wedges.get(e.id)!;
      expect(wedge.visible).toBe(true); expect(wedge.rotation.y).toBe(e.lockedYaw);
      const positions = wedge.geometry.getAttribute('position');
      let maxR = 0;
      for (let i = 0; i < positions.count; i++) maxR = Math.max(maxR, Math.hypot(positions.getX(i), positions.getZ(i)));
      expect(maxR).toBeCloseTo(ENEMIES.warden.cleaveReach + PLAYER.radius, 5);
      e.phase = 'recovery'; graph.updateTelegraphs(1); expect(wedge.visible).toBe(false);
      e.warden!.attack = 'rush'; e.phase = 'charge'; e.chargeDist = 2; graph.updateTelegraphs(1);
      const lane = graph.wardenLanes.get(e.id)!;
      expect(lane.visible).toBe(true); expect(lane.scale.x).toBe(2 * (e.radius + PLAYER.radius));
      expect(lane.scale.z).toBe(ENEMIES.warden.rushDist - 2 + 2 * (e.radius + PLAYER.radius));
      expect(lane.rotation.y).toBe(e.lockedYaw);
      e.warden!.attack = 'lance'; e.phase = 'aim'; e.aimPoint = { x: 9.5, y: 1.2, z: 1.5 }; graph.updateTelegraphs(1);
      const line = graph.aimLines.get(e.id)!;
      expect(line.visible).toBe(true); expect(line.position.y).toBe(e.y + ENEMIES.warden.lanceHeight);
      expect(lane.scale.x).toBe(2 * (ENEMIES.warden.lanceRadius + PLAYER.radius));
      e.phase = 'stagger'; graph.updateTelegraphs(1);
      expect(line.visible).toBe(false); expect(lane.visible).toBe(false);
    } finally { fx.dispose(); vi.unstubAllGlobals(); }
  });
});
