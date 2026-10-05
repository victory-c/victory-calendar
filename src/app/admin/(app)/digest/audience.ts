import { selectForVariant } from '@/lib/digest/select';
import type { DigestSnapshot } from '@/lib/digest/types';
import { type Variant, variantKey } from '@/lib/digest/variant';

// /admin/digest audience list: one render per distinct email instead of one per variant. The
// template reads a variant's categories only through selectForVariant, so two variants of the same
// language whose picked categories have the same content (a pick this week or a preview item) get
// byte-identical emails, and every variant with no picks gets the same empty notice.

/** What a variant's email depends on: language + the picked categories that have something to show. */
export function emailKey(snap: DigestSnapshot, v: Variant): string {
  try {
    const s = selectForVariant(snap, v.categories);
    if (s.picks === 0) return `${v.locale}:empty`;
    return variantKey(v.locale, [...s.sections.map((x) => x.category), ...s.preview.map((e) => e.category)]);
  } catch {
    return v.key; // a malformed snapshot: render this variant on its own and let it report the error
  }
}

/**
 * `render` once per distinct email, mapped back to every variant, in order. At most `limit` new
 * renders (variants whose email is past the cap get null); `known` holds renders already done.
 */
export async function renderPerEmail<T>(
  snap: DigestSnapshot,
  variants: readonly Variant[],
  render: (v: Variant) => Promise<T>,
  { limit, known = [] }: { limit: number; known?: readonly (readonly [Variant, T])[] },
): Promise<(T | null)[]> {
  const jobs = new Map<string, Promise<T>>(known.map(([v, r]) => [emailKey(snap, v), Promise.resolve(r)]));
  let fresh = 0;
  const keys = variants.map((v) => {
    const k = emailKey(snap, v);
    if (!jobs.has(k) && fresh < limit) {
      jobs.set(k, render(v));
      fresh++;
    }
    return k;
  });
  return Promise.all(keys.map((k) => jobs.get(k) ?? null));
}
