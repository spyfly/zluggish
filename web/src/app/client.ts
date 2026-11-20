import { mount } from 'svelte';
import '../theme/theme.css';
import App from './App.svelte';

const target = document.getElementById('app');

if (!target) {
  throw new Error('The page has no #app element.');
}
mount(App, { target });
