import { ACTIONS, ARMORS, UPGRADE, WEAPONS, weaponTotal, type ArmorId, type WeaponId } from '../config';
import { armorFootstepRadius, armorReduction, armorSneakSpeedMul, armorUpgradeLimit, bowDamage, weaponDamage } from '../sim/equipment';

/** Plain text keeps inventory labels testable without a DOM or duplicate combat maths. */
export interface EquipmentPresentation {
  summary: string;
  details: string;
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const pct = (n: number): string => `${fmt(n * 100)}%`;
const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const delta = (n: number, unit = ''): string => Math.abs(n) < 1e-9 ? '相同' : `${signed(n)}${unit}`;
const nameAt = (name: string, level: number): string => `${name} +${level}`;
const phases = (id: WeaponId): string => {
  const s = WEAPONS[id];
  return `${pct(s.move.windup)}／${pct(s.move.active)}／${pct(s.move.recovery)}`;
};

export function weaponPresentation(id: WeaponId, level: number): EquipmentPresentation {
  const s = WEAPONS[id], damage = weaponDamage(id, level);
  const targets = s.maxTargets > 1
    ? `最多 ${s.maxTargets} 敵，次敵 ${fmt(damage * s.secondaryDamage)} 傷害（${pct(s.secondaryDamage)}）`
    : `最多 ${s.maxTargets} 敵`;
  const surprise = s.sneakMultiplier > 1 ? ` · 奇襲 ×${fmt(s.sneakMultiplier)}` : '';
  const stagger = s.stagger > 0
    ? `；命中失衡 ${fmt(s.stagger)} 秒，次敵 ${fmt(s.stagger * s.secondaryDamage)} 秒`
    : '';
  return {
    summary: `主傷 ${fmt(damage)} · 距離 ${fmt(s.reach)} m · 基礎 ${fmt(weaponTotal(id))} 秒 · ${targets}${surprise}`,
    details: `準備／出手／收招：${fmt(s.windup)}／${fmt(s.active)}／${fmt(s.recovery)} 世界秒；各階段移速保留 ${phases(id)}（越低越難走位）；攻擊角 ${fmt(s.arcDeg)}°${stagger}${s.sneakMultiplier > 1 ? '；奇襲：從背後攻擊未目擊你的閒置／巡邏敵人，或攻擊睡著的敵人' : ''}。${s.note}`,
  };
}

export function armorPresentation(id: ArmorId, level: number, lightstepSpeed = 1): EquipmentPresentation {
  const cap = armorUpgradeLimit(id), reduction = armorReduction(id, level);
  const limit = id === 'cloth' ? '布衣不能強化'
    : reduction >= UPGRADE.armorMaxReduce ? `減傷自 +${cap} 達上限，不能再強化`
      : `強化至 +${cap} 達減傷上限`;
  const state = id === 'cloth' ? ' · 布衣不能強化' : reduction >= UPGRADE.armorMaxReduce ? ' · 已達減傷上限' : '';
  return {
    summary: `減傷 ${fmt(reduction)}／次（上限 ${UPGRADE.armorMaxReduce}） · 行走腳步半徑 ${fmt(armorFootstepRadius(id))} m · 潛行移速 ${pct(armorSneakSpeedMul(id, lightstepSpeed))}${state}`,
    details: `${limit}；每次受傷至少 1；潛行不發出腳步聲。潛行移速以正常行走為 100%${lightstepSpeed !== 1 ? `，已計輕步 ×${fmt(lightstepSpeed)}` : ''}`,
  };
}

export function bowPresentation(level: number): EquipmentPresentation {
  const s = ACTIONS.bow;
  return {
    summary: `身體 ${fmt(bowDamage(level, false))} · 頭部 ${fmt(bowDamage(level, true))} 傷害 · 基礎 ${fmt(s.windup + s.active + s.recovery)} 秒`,
    details: `準備／出手／收招：${fmt(s.windup)}／${fmt(s.active)}／${fmt(s.recovery)} 世界秒；每級身體 +${UPGRADE.bowBody}、頭部 +${UPGRADE.bowHead}，最高 +${UPGRADE.maxLevel}；盾牌與角盔可擋箭`,
  };
}

/** Compare each axis on its own: more damage never erases a slower commitment. */
export function compareWeapons(id: WeaponId, level: number, currentId: WeaponId, currentLevel: number): EquipmentPresentation {
  const candidate = WEAPONS[id], current = WEAPONS[currentId];
  const timeDelta = weaponTotal(id) - weaponTotal(currentId);
  const timing = Math.abs(timeDelta) < 1e-9 ? '動作時間相同' : `動作${timeDelta > 0 ? '慢' : '快'} ${fmt(Math.abs(timeDelta))} 秒`;
  return {
    summary: `對比目前 ${nameAt(current.name, currentLevel)}：主傷 ${delta(weaponDamage(id, level) - weaponDamage(currentId, currentLevel))} · 距離 ${delta(candidate.reach - current.reach, ' m')} · ${timing}`,
    details: `同槽取捨：最多命中 ${current.maxTargets} → ${candidate.maxTargets} 敵；奇襲 ×${fmt(current.sneakMultiplier)} → ×${fmt(candidate.sneakMultiplier)}；準備／出手／收招移速 ${phases(currentId)} → ${phases(id)}；攻擊角 ${fmt(current.arcDeg)}° → ${fmt(candidate.arcDeg)}°`,
  };
}

export function compareArmors(id: ArmorId, level: number, currentId: ArmorId, currentLevel: number, lightstepSpeed = 1): EquipmentPresentation {
  const noise = armorFootstepRadius(id) - armorFootstepRadius(currentId);
  const speed = armorSneakSpeedMul(id, lightstepSpeed) - armorSneakSpeedMul(currentId, lightstepSpeed);
  const noiseText = Math.abs(noise) < 1e-9 ? '腳步半徑相同' : `腳步半徑${noise > 0 ? '增' : '減'} ${fmt(Math.abs(noise))} m（${noise > 0 ? '更吵' : '更安靜'}）`;
  const speedText = Math.abs(speed) < 1e-9 ? '潛行移速相同' : `潛行${speed > 0 ? '快' : '慢'} ${fmt(Math.abs(speed) * 100)} 百分點`;
  return {
    summary: `對比目前 ${nameAt(ARMORS[currentId].name, currentLevel)}：減傷 ${delta(armorReduction(id, level) - armorReduction(currentId, currentLevel))} · ${noiseText} · ${speedText}`,
    details: `較高減傷可降低承傷，至少仍受 1；腳步半徑越小，越不易驚動遠處敵人；潛行移速 ${pct(armorSneakSpeedMul(currentId, lightstepSpeed))} → ${pct(armorSneakSpeedMul(id, lightstepSpeed))}${lightstepSpeed !== 1 ? '（兩邊皆已計輕步）' : ''}`,
  };
}
