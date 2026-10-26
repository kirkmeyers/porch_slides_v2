// Theme configs with their theme files, for the browser build.
import genericUrl from './porch-generic/Theme.bin?url';
import loversUrl from './lovers/Theme.bin?url';
import { THEME_CONFIGS } from './configs.js';

const FILES = { 'porch-generic': genericUrl, lovers: loversUrl };

export const THEMES = THEME_CONFIGS.map(c => ({ ...c, themeUrl: FILES[c.file], assets: {} }));
