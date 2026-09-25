import { PLAYER } from '../config';
import type { PickupKind } from '../gen/generator';
import type { Player } from './types';

export type StockKey = 'arrows' | 'stones' | 'bottles' | 'potions';

/**
 * 這種物資對這個玩家是什麼、上限多少。
 * 彈藥袋依職業變成一般箭（獵手）或投擲石（戰士）；用不到的東西回傳 null（例如戰士撿到箭）。
 */
export function stockFor(p: Player, kind: PickupKind): { key: StockKey; max: number } | null {
  switch (kind) {
    case 'ammo':
      return p.cls === 'huntress' ? { key: 'arrows', max: PLAYER.maxArrows } : { key: 'stones', max: PLAYER.maxStones };
    case 'arrows':
      return p.cls === 'huntress' ? { key: 'arrows', max: PLAYER.maxArrows } : null;
    case 'stone':
      return p.cls === 'warrior' ? { key: 'stones', max: PLAYER.maxStones } : null;
    case 'bottle':
      return { key: 'bottles', max: PLAYER.maxBottles };
    case 'potion':
      return { key: 'potions', max: PLAYER.maxPotions };
  }
}

export const STOCK_NAMES: Record<StockKey, string> = { arrows: '一般箭', stones: '投擲石', bottles: '煙霧瓶', potions: '藥水' };
