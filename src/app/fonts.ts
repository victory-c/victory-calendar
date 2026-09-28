// Latin fonts via next/font (self-hosted at build time, no runtime Google dependency).
// Budget calibrated with Lighthouse CI (PROGRESS.md): only the faces the first paint needs
// are preloaded: Geist, Fraunces roman and the small static Fraunces italic.
import { Fraunces, Geist, Geist_Mono } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal'],
  variable: '--font-fraunces',
  display: 'swap',
});

// Notes are small text, so the italic skips the opsz axis (much smaller file) and is preloaded:
// on list pages a note is often the largest text block, i.e. the LCP element.
export const frauncesItalic = Fraunces({
  subsets: ['latin'],
  style: ['italic'],
  weight: '400',
  variable: '--font-fraunces-italic',
  display: 'swap',
});

export const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });

export const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap', preload: false });

export const fontVars = `${fraunces.variable} ${frauncesItalic.variable} ${geist.variable} ${geistMono.variable}`;
