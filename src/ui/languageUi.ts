import { Localizer, validLanguage } from './i18n';
import { SettingsStore } from './settings';
let activeStore: SettingsStore;
let localizer: Localizer | null = null;
/** Shared by normal entry and the bootstrap failure path; never binds a selector twice. */
export function initializeLanguageUi(settings?: SettingsStore): void {
  activeStore = settings ?? new SettingsStore();
  if (!settings) activeStore.load();
  if (localizer) return;
  localizer = new Localizer(document.body, activeStore.value.language);
  const selectors = Array.from(document.querySelectorAll<HTMLSelectElement>('[data-language]'));
  for (const select of selectors) {
    select.value = activeStore.value.language;
    select.addEventListener('change', () => {
      const language = validLanguage(select.value);
      activeStore.update({ language });
      localizer!.setLanguage(language);
      for (const other of selectors) other.value = language;
    });
  }
}
