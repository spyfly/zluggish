import 'vite/modulepreload-polyfill';
import '../theme/theme.css';
import { hydrate, mount } from 'svelte';
import Game from './pages/Game.svelte';
import { gamePageModel } from '../lib/game-app';

const target = document.querySelector<HTMLElement>('#launcher-ui');
const data = document.querySelector('#launcher-props');

if (target && data?.textContent) {
  const page = gamePageModel.parse(JSON.parse(data.textContent));

  if (['login', 'unlock', 'add', 'dashboard'].includes(page.kind)) {
    hydrate(Game, { target, props: { page } });
  } else {
    target.replaceChildren();
    mount(Game, { target, props: { page } });
  }
}
