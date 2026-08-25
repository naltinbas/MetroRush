import './ui/styles.css';
import { applyQueryOverrides } from './game/Config';
import { Game } from './game/Game';

applyQueryOverrides(window.location.search);

function showFatal(message: string): void {
  const el = document.getElementById('error');
  const msg = document.getElementById('error-message');
  if (el && msg) {
    msg.textContent = message;
    el.classList.remove('hidden');
  }
  for (const id of ['screen-menu', 'hud', 'screen-pause', 'screen-gameover']) {
    document.getElementById(id)?.classList.add('hidden');
  }
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection', e.reason);
  e.preventDefault();
});

try {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app container');
  const game = new Game(container);
  game.start();
  (window as unknown as { metroRush: Game }).metroRush = game;
} catch (err) {
  console.error(err);
  showFatal(err instanceof Error ? err.message : String(err));
}
