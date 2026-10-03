import './ui/style.css';
import { initializeLanguageUi } from './ui/languageUi';
import { showGameFailure } from './ui/failure';
// Dynamic import makes module/chunk and renderer startup failure recoverable.
void import('./main').then(() => {
  document.body.classList.remove('booting');
  document.getElementById('boot-status')?.remove();
}).catch(error => {
  console.error('Game startup failed', error);
  initializeLanguageUi();
  showGameFailure('startup');
});
