import { en } from './game-en';
import { createTranslator } from './translate';

export type MessageKey = keyof typeof en;
export const t = createTranslator(en);
