// Latin fonts via next/font + the geist package; CJK via self-hosted slices (globals.css).
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { Fraunces } from 'next/font/google';

export const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

export const fontVars = `${fraunces.variable} ${GeistSans.variable} ${GeistMono.variable}`;
