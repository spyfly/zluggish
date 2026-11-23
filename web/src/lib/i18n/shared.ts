import { en } from './shared-en';
import { createTranslator } from './translate';

export type MessageKey = keyof typeof en;
export const t = createTranslator(en);
