import { expect } from 'vitest';

// Checks every newsletter email must pass (the going alert's tests; the digest's tests keep their
// own copy of the same rules). Plain functions over the rendered strings, no imports from src.

/** Doctype, lang, tables only, safe images, dark mode on every painted element, Outlook ghost table. */
export function expectEmailSafe(html: string, locale: 'en' | 'zh') {
  const lang = locale === 'zh' ? 'zh-Hans' : 'en';
  expect(html).toMatch(/^<!DOCTYPE html PUBLIC "-\/\/W3C\/\/DTD XHTML 1\.0 Transitional\/\/EN"/);
  expect(html).toMatch(new RegExp(`<html[^>]*\\slang="${lang}"`));
  expect(html).toMatch(new RegExp(`<body[^>]*\\slang="${lang}"`));
  expect(html).not.toMatch(/display:\s*(flex|grid)|position:|float:|var\(--|oklch\(|\d(\.\d+)?rem\b|<svg|src="data:|<script|<link/);
  const imgs = html.match(/<img\b[^>]*>/g) ?? [];
  for (const tag of imgs) {
    expect(tag).toMatch(/\ssrc="https:\/\/[^"]+"/);
    expect(tag).toMatch(/\salt="[^"]+"/);
    expect(tag).toMatch(/\swidth="\d+"/);
    expect(tag).toMatch(/\sheight="\d+"/);
  }
  // No address anywhere (the only @ allowed is the dark-mode media query).
  expect(html.replace(/@media/g, '')).not.toContain('@');
  expect(html).toContain('name="color-scheme" content="light dark"');
  expect(html).toMatch(/\[data-ogsc\]/);
  const painted = (html.match(/<[a-z]+\b[^>]*>/g) ?? []).filter((tag) => /background-color:|\sbgcolor="/.test(tag));
  expect(painted.length).toBeGreaterThanOrEqual(3); // body, full-width wrapper, 600 px column
  for (const tag of painted) expect(tag, tag).toMatch(/\sclass="[^"]*\b(bg|btn|chip)\b/);
  expect(html).toMatch(/<body\b[^>]*\sclass="bg"/);
  const open = html.indexOf('<!--[if mso]><table role="presentation" width="600" align="center"');
  const column = html.indexOf('max-width:600px');
  const close = html.indexOf('<!--[if mso]></td></tr></table><![endif]-->');
  expect(open).toBeGreaterThan(0);
  expect(open).toBeLessThan(column);
  expect(close).toBeGreaterThan(column);
  expect(html).toMatch(/<html\b[^>]*\sxmlns:o="urn:schemas-microsoft-com:office:office"/);
  expect(html).toMatch(/<o:PixelsPerInch>96<\/o:PixelsPerInch>[^]*<\/head>/);
  expect(html).not.toContain('data-vp-mso');
  return imgs;
}

/** Plain-text part: every URL sits in <…>, so no linkifier runs it into the text after it. */
export function expectTextLinksDelimited(text: string) {
  const urls = [...text.matchAll(/(.?)(https?:\/\/[^\s<>]+)(.?)/g)];
  expect(urls.length).toBeGreaterThan(0);
  for (const [whole, before, , after] of urls) expect([before, after], whole).toEqual(['<', '>']);
}
