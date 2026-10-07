import type { PublicCover } from '../events/types';

// Credits for covers picked from the cover selector's search sources (M4 F11; guide「版权」).
// Pure, so the site, email and OG card agree. Openverse covers carry TASL (title, author, source,
// licence), stored in covers.attribution as `"Title" by Creator · CC BY-SA 2.0` (+ how the image
// was changed to fit the square) and covers.license as `by-sa/2.0`.

export const OPENVERSE_LICENSES = ['cc0', 'by', 'by-sa'] as const;
export type OpenverseLicense = (typeof OPENVERSE_LICENSES)[number];

export const isOpenverseLicense = (v: unknown): v is OpenverseLicense =>
  typeof v === 'string' && (OPENVERSE_LICENSES as readonly string[]).includes(v);

/** covers.license value: `by-sa/2.0`, `cc0/1.0`. */
export function licenseCode(license: OpenverseLicense, version: string | null | undefined) {
  const v = (version ?? '').trim();
  return `${license}/${/^\d+(\.\d+)?$/.test(v) ? v : license === 'cc0' ? '1.0' : '4.0'}`;
}

function parseCode(code: string | null | undefined): { license: OpenverseLicense; version: string } | null {
  const [license, version] = (code ?? '').split('/');
  return isOpenverseLicense(license) && /^\d+(\.\d+)?$/.test(version ?? '') ? { license, version } : null;
}

/** `by-sa/2.0` → `CC BY-SA 2.0`; `cc0/1.0` → `CC0 1.0`. */
export function licenseLabel(code: string | null | undefined): string | null {
  const p = parseCode(code);
  if (!p) return null;
  return p.license === 'cc0' ? `CC0 ${p.version}` : `CC ${p.license.toUpperCase()} ${p.version}`;
}

/** The licence deed on creativecommons.org. */
export function licenseUrl(code: string | null | undefined): string | null {
  const p = parseCode(code);
  if (!p) return null;
  return p.license === 'cc0'
    ? `https://creativecommons.org/publicdomain/zero/${p.version}/`
    : `https://creativecommons.org/licenses/${p.license}/${p.version}/`;
}

/** licenseUrl's inverse: a creativecommons.org deed back to its covers.license code, else null. */
export function licenseCodeOfUrl(url: string | null | undefined): string | null {
  const m = /^https:\/\/creativecommons\.org\/(?:licenses\/(by|by-sa)|publicdomain\/zero)\/(\d+(?:\.\d+)?)\/$/.exec(url ?? '');
  return m ? `${m[1] ?? 'cc0'}/${m[2]}` : null;
}

/** How processCover changed the picture to fill the square (CC BY asks to say so). */
export type CoverEdit = 'cropped' | 'padded';
const EDIT_TEXT: Record<CoverEdit, string> = { cropped: 'cropped', padded: 'padded to square' };

export const coverEdit = (p: { letterboxed: boolean; width: number; height: number }): CoverEdit | null =>
  p.letterboxed ? 'padded' : p.width !== p.height ? 'cropped' : null;

const clean = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** `"Title" by Creator · CC BY-SA 2.0`, plus ` · cropped` / ` · padded to square` when changed. */
export function formatOpenverseCredit(o: {
  title: string | null; creator: string | null; license: OpenverseLicense; version: string | null; edit?: CoverEdit | null;
}): string {
  const title = clean(o.title, 120);
  const creator = clean(o.creator, 80);
  const work = `${title ? `"${title}"` : 'Untitled image'}${creator ? ` by ${creator}` : ''}`;
  const edit = o.edit ? ` · ${EDIT_TEXT[o.edit]}` : '';
  return `${work} · ${licenseLabel(licenseCode(o.license, o.version))}${edit}`;
}

/** The stored Openverse credit split back into its parts, for linking the work and the licence. */
export function openverseCreditParts(attribution: string | null, license: string | null) {
  const label = licenseLabel(license);
  if (!attribution || !label) return null;
  const at = attribution.lastIndexOf(` · ${label}`);
  if (at <= 0) return null;
  const rest = attribution.slice(at + label.length + 3);
  const edit = (Object.keys(EDIT_TEXT) as CoverEdit[]).find((k) => rest === ` · ${EDIT_TEXT[k]}`) ?? null;
  if (rest && !edit) return null;
  return { work: attribution.slice(0, at), licenseLabel: label, licenseHref: licenseUrl(license), edit };
}

/** `Image via example.org` for a Brave pick (the page the image was found on). */
export function viaHost(pageUrl: string | null | undefined): string | null {
  try {
    return pageUrl ? new URL(pageUrl).hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

/**
 * OG share cards have no room for a credit line, so they only draw covers that need none: Brave
 * finds (licence unknown) and Openverse covers other than CC0 fall back to the template.
 */
export function shareCardAllowed(cover: Pick<PublicCover, 'kind' | 'license'> | null): boolean {
  if (!cover || cover.kind === 'template' || cover.kind === 'brave') return false;
  if (cover.kind === 'openverse') return parseCode(cover.license)?.license === 'cc0';
  return true;
}
