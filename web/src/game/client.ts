import 'vite/modulepreload-polyfill';
import '../theme/theme.css';
import { hydrate, mount } from 'svelte';
import Game from './pages/Game.svelte';
import type { GamePageModel } from '../lib/game-app.dto';

const target = document.querySelector<HTMLElement>('#launcher-ui');
const data = document.querySelector('#launcher-props');

if (target && data?.textContent) {
  // SAFETY: props are serialized by the same-origin Svelte render adapter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const page = JSON.parse(data.textContent) as GamePageModel;

  if (['login', 'unlock', 'add', 'dashboard'].includes(page.kind)) {
    hydrate(Game, { target, props: { page } });
  } else {
    target.replaceChildren();
    mount(Game, { target, props: { page } });
  }
}
