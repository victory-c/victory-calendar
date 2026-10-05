import 'server-only';
import { Resend } from 'resend';
import { maskEmail } from '../email/send';

// How a digest batch leaves the building (guide「digest 发送」, resend.md). One call carries up to
// 100 personalised emails, possibly of different variants; Resend's Idempotency-Key makes a retry of
// the same group with the same bytes a replay instead of a second send. The transport never throws:
// every outcome comes back as a value that classify() turns into the runner's next step. Error
// messages from Resend can echo recipients, so they are carried but never logged.

export type BatchEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
};

export type BatchError = { name: string; statusCode: number | null; message: string };

/**
 * `ids[i]` is the Resend id of `emails[i]`, or null when that email was rejected (its index is in
 * `invalid`). `ids` is null when the response can't be paired with the payload.
 */
export type BatchOk = { ok: true; ids: (string | null)[] | null; invalid: number[]; dailyUsed: number | null };
export type BatchErr = { ok: false; error: BatchError; retryAfterMs: number | null };
export type BatchMode = 'strict' | 'permissive';
export type BatchTransport = (emails: BatchEmail[], idempotencyKey: string, mode: BatchMode) => Promise<BatchOk | BatchErr>;

export const MAX_BATCH = 100;

/** Until mail.<domain> is verified the cron is off on Vercel (digestMode), so this default only shows up in dev logs. */
export const digestFrom = () => process.env.RESEND_FROM || "Victor's Picks <onboarding@resend.dev>";

function checkSize(emails: BatchEmail[]) {
  if (emails.length < 1 || emails.length > MAX_BATCH) throw new Error(`digest batch size ${emails.length}`);
}

/**
 * Resend's batch endpoint. The client is built on the first call (`new Resend(undefined)` throws, and
 * a module-level client would break imports in CI); a missing key comes back as a stop error.
 */
export function resendTransport(apiKey = process.env.RESEND_API_KEY): BatchTransport {
  let client: Resend | null = null;
  return async (emails, idempotencyKey, mode) => {
    checkSize(emails);
    if (!apiKey) return { ok: false, error: { name: 'missing_api_key', statusCode: null, message: 'RESEND_API_KEY is not set' }, retryAfterMs: null };
    let r: Awaited<ReturnType<Resend['batch']['send']>>;
    try {
      client ??= new Resend(apiKey);
      r = await client.batch.send(emails, { idempotencyKey, batchValidation: mode });
    } catch (e) {
      // The SDK reports HTTP failures as values; a throw is a local or network fault: outcome unknown.
      return { ok: false, error: { name: 'application_error', statusCode: null, message: e instanceof Error ? e.name : 'error' }, retryAfterMs: null };
    }
    const h = r.headers ?? {};
    if (r.error) {
      const s = Number(h['retry-after']);
      return { ok: false, error: { name: r.error.name, statusCode: r.error.statusCode, message: r.error.message }, retryAfterMs: Number.isFinite(s) && s >= 0 ? s * 1000 : null };
    }
    const created = (r.data?.data ?? []).map((d: { id: string }) => d.id);
    const errors = (r.data as { errors?: { index: number }[] } | null)?.errors ?? [];
    const invalid = [...new Set(errors.map((e) => e.index).filter((i) => Number.isInteger(i) && i >= 0 && i < emails.length))].sort((a, b) => a - b);
    const used = Number(h['x-resend-daily-quota']);
    return { ok: true, ids: alignIds(emails.length, created, invalid), invalid, dailyUsed: Number.isFinite(used) && h['x-resend-daily-quota'] ? used : null };
  };
}

/** Local and CI ('dev' mode): one masked line per batch, nothing leaves the machine, rows get resend_id 'dev'. */
export const devTransport: BatchTransport = async (emails, idempotencyKey, mode) => {
  checkSize(emails);
  console.info(`[digest:dev] batch n=${emails.length} mode=${mode} key=${idempotencyKey} first=${maskEmail(emails[0].to)} subject=${emails[0].subject}`);
  return { ok: true, ids: emails.map(() => 'dev'), invalid: [], dailyUsed: null };
};

/**
 * Pair Resend's ids with payload positions. Strict mode: data[i] is payload[i] (documented).
 * Permissive mode: data lists the created emails only, so the rejected indices are skipped. Any
 * other shape is not guessed at: null, and the caller marks the group id_mismatch.
 */
export function alignIds(n: number, ids: readonly string[], invalid: readonly number[]): (string | null)[] | null {
  if (invalid.length === 0 && ids.length === n) return [...ids];
  const skip = new Set(invalid);
  const kept = [...Array(n).keys()].filter((i) => !skip.has(i));
  if (ids.length === kept.length) {
    const out = Array<string | null>(n).fill(null);
    kept.forEach((i, k) => (out[i] = ids[k]));
    return out;
  }
  if (ids.length === n) return ids.map((id, i) => (skip.has(i) ? null : id));
  return null;
}

/**
 * What the runner does after a failed call (resend.md「How to handle each error」):
 * retry — same key, after a pause (rate limit, request in flight, 5xx, network);
 * permissive — the payload has a bad email: resend the group with batchValidation 'permissive';
 * conflict — same key, different body (409): never resend automatically, the first copy may be out;
 * stop — quota or configuration: end the run, claims stay for the next one.
 */
export type NextStep = 'retry' | 'stop' | 'permissive' | 'conflict';

export function classify(e: Pick<BatchError, 'name' | 'statusCode'>): NextStep {
  switch (e.name) {
    case 'rate_limit_exceeded':
    case 'concurrent_idempotent_requests':
    case 'internal_server_error':
      return 'retry';
    case 'invalid_idempotent_request':
      return 'conflict';
    case 'daily_quota_exceeded':
    case 'monthly_quota_exceeded':
    case 'missing_api_key':
    case 'invalid_api_key':
    case 'restricted_api_key':
    case 'invalid_from_address':
    case 'invalid_idempotency_key':
    case 'security_error':
    case 'invalid_access':
    case 'not_found':
    case 'method_not_allowed':
      return 'stop';
    case 'validation_error':
    case 'missing_required_field':
    case 'invalid_parameter':
    case 'invalid_attachment':
      // 403 = unverified domain or the resend.dev sender: no payload change will help.
      return e.statusCode === 403 ? 'stop' : 'permissive';
  }
  return e.statusCode === null || e.statusCode >= 500 ? 'retry' : 'stop';
}
