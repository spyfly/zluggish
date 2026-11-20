declare module '*.svelte' {
  import type { GamePageModel } from '#src/dtos/game-app.dto';
  import type { Component } from 'svelte';

  const component: Component<{ page: GamePageModel }>;
  export default component;
}
