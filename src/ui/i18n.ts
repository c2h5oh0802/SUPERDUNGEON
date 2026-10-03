import { controlText } from './controlText';
import { staticEnglish } from './locales/static';
import { worldEnglish } from './locales/world';
import { gameEnglish } from './locales/game';

export type Language = 'en' | 'zh-Hant';
const base: Record<string, string> = { ...staticEnglish, ...worldEnglish, ...gameEnglish };
const touchEnglish = (text: string): string => text
  .replace(/^E /, 'Interact: ')
  .replaceAll('Press I to open your inventory', 'Tap Inventory')
  .replaceAll('Press I for inventory', 'Tap Inventory')
  .replaceAll('press 3 again to switch', 'tap tipped arrows again to switch')
  .replaceAll('press 3 again', 'tap tipped arrows again')
  .replaceAll('hold Shift to sneak', 'turn on Sneak')
  .replaceAll('Hold Shift to sneak', 'Turn on Sneak')
  .replaceAll('Shift to sneak', 'Sneak')
  .replaceAll('Shift: walk slowly and silently', 'Sneak to walk slowly and silently')
  .replaceAll('left-click when', 'tap Shoot when')
  .replaceAll('Left-click when', 'Tap Shoot when')
  .replaceAll('Right-click or F', 'Tap Bash')
  .replaceAll('right-click or F', 'tap Bash')
  .replaceAll('1 for sword', 'Select melee')
  .replaceAll('Press E', 'Tap Interact').replaceAll('press E', 'tap Interact')
  .replaceAll('(E)', '(Interact)').replaceAll('[E]', 'Interact')
  .replaceAll('Esc', 'Pause').replaceAll('Tab', 'Map');
const touchVariants = Object.fromEntries(Object.entries(base).filter(([source]) => controlText(source, true) !== source)
  .map(([source, translated]) => [controlText(source, true), touchEnglish(translated)]));
const joinedFragments = Object.fromEntries(Object.entries(base).filter(([source]) => /^\s*·\s+/.test(source))
  .map(([source, translated]) => [source.replace(/^\s*·\s+/, ''), translated.replace(/^\s*·\s+/, '')]));
export const ENGLISH: Readonly<Record<string, string>> = { ...joinedFragments, ...touchVariants, ...base };
const han = /\p{Script=Han}/u;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(ENGLISH).filter(([s]) => /\{\d+\}/.test(s)).map(([source, value]) => {
  const slots: number[] = [];
  const parts = source.split(/(\{\d+\})/g).map(p => {
    if (/^\{\d+\}$/.test(p)) { slots.push(Number(p.slice(1, -1))); return '([\\s\\S]*?)'; }
    return escape(p);
  });
  return { pattern: new RegExp(`^${parts.join('')}$`), value, slots, weight: source.replace(/\{\d+\}/g, '').length };
}).sort((a, b) => b.weight - a.weight);
const literals = Object.keys(ENGLISH).filter(s => s && han.test(s) && !/\{\d+\}/.test(s)).sort((a, b) => b.length - a.length);
const fragments = new RegExp(literals.map(escape).join('|'), 'gu');
const cache = new Map<string, string>();
let language: Language = 'en';
export const getLanguage = (): Language => language;
export const validLanguage = (value: unknown): Language => value === 'zh-Hant' ? 'zh-Hant' : 'en';

/** Translate display text only. Stable simulation IDs, saves, seeds and analytics never pass here. */
export function english(text: string, depth = 0): string {
  if (depth > 8) return text;
  const exact = ENGLISH[text];
  if (exact !== undefined) return exact;
  const trimmed = text.trim();
  if (trimmed !== text && ENGLISH[trimmed] !== undefined) return text.replace(trimmed, ENGLISH[trimmed]!);
  if (!han.test(text)) return text;
  const colonPrefix = /^(\s*)：/.exec(text);
  if (colonPrefix) return `${colonPrefix[1]}: ${english(text.slice(colonPrefix[0].length), depth + 1)}`;
  let best = text.replace(fragments, source => ENGLISH[source]!);
  const remaining = (s: string) => (s.match(/\p{Script=Han}/gu) ?? []).length;
  for (const entry of templates) {
    const match = entry.pattern.exec(trimmed);
    if (!match) continue;
    const values = new Map(entry.slots.map((slot, i) => [slot, english(match[i + 1]!, depth + 1)]));
    const translated = entry.value.replace(/\{(\d+)\}/g, (_, id: string) => values.get(Number(id)) ?? '');
    const result = text.replace(trimmed, translated);
    if (!han.test(result)) return result;
    if (remaining(result) < remaining(best)) best = result;
  }
  // Composition of independently generated labels (names, counters and separators).
  for (const separator of [/(\n)/, /(?<=。)/, /(?<=；)/, /( · )/]) {
    const chunks = text.split(separator);
    if (chunks.length < 2) continue;
    const composed = chunks.map(part => english(part, depth + 1)).join('');
    if (remaining(composed) < remaining(best)) best = composed;
    if (!han.test(best)) return best;
  }
  const translated = best.replace(fragments, source => ENGLISH[source]!);
  return translated;
}
export function localize(text: string): string {
  if (language === 'zh-Hant') return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const value = english(text);
  if (cache.size >= 2048) cache.clear();
  cache.set(text, value);
  return value;
}

type Translation = { source: string; rendered: string };
const attributes = ['title', 'aria-label', 'placeholder', 'alt'];
/** Localizes only changed presentation nodes before paint, never event values or live inputs.
 * Original text is retained per node so repeated switches are lossless. No whole-HUD scan per frame. */
export class Localizer {
  private texts = new WeakMap<Node, Translation>();
  private attrs = new WeakMap<Element, Map<string, Translation>>();
  private observer: MutationObserver | null = null;
  constructor(private root: HTMLElement, initial: Language) {
    language = initial;
    // Pure simulation/UI-stub test environments have no DOM observer.
    if (typeof MutationObserver === 'undefined' || !root.ownerDocument?.createTreeWalker) return;
    this.observer = new MutationObserver(records => this.changed(records));
    this.refresh();
    this.observe();
  }
  private observe(): void {
    this.observer?.observe(this.root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
  }
  private excluded(node: Node): boolean {
    const el = node.nodeType === 1 ? node as Element : node.parentElement;
    return !!el?.closest('script, style, noscript, [data-no-localize]');
  }
  private text(node: Node): void {
    if (this.excluded(node)) return;
    const current = node.nodeValue ?? '';
    const prior = this.texts.get(node);
    const source = prior && current === prior.rendered ? prior.source : current;
    const rendered = localize(source);
    this.texts.set(node, { source, rendered });
    if (current !== rendered) node.nodeValue = rendered;
  }
  private element(el: Element): void {
    if (this.excluded(el)) return;
    let saved = this.attrs.get(el);
    if (!saved) { saved = new Map(); this.attrs.set(el, saved); }
    for (const key of attributes) {
      const current = el.getAttribute(key);
      if (current === null) continue;
      const prior = saved.get(key);
      const source = prior && current === prior.rendered ? prior.source : current;
      const rendered = localize(source);
      saved.set(key, { source, rendered });
      if (current !== rendered) el.setAttribute(key, rendered);
    }
  }
  private walk(node: Node): void {
    if (node.nodeType === 3) { this.text(node); return; }
    if (node.nodeType !== 1 || this.excluded(node)) return;
    this.element(node as Element);
    const walker = this.root.ownerDocument.createTreeWalker(node, 1 | 4);
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType === 3) this.text(walker.currentNode);
      else this.element(walker.currentNode as Element);
    }
  }
  private changed(records: MutationRecord[]): void {
    this.observer?.disconnect();
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(n => this.walk(n));
      else if (record.type === 'characterData') this.text(record.target);
      else this.element(record.target as Element);
    }
    this.observe();
  }
  refresh(): void {
    if (!this.observer) return;
    this.changed(this.observer.takeRecords());
    this.observer.disconnect();
    this.walk(this.root);
    const doc = this.root.ownerDocument;
    doc.documentElement.lang = language;
    doc.title = language === 'en' ? 'The Slumbering Heart · SUPERDUNGEON' : '沉眠之心 · SUPERDUNGEON';
    this.observe();
  }
  setLanguage(next: Language): void {
    if (this.observer) this.changed(this.observer.takeRecords());
    language = next;
    this.refresh();
  }
}
