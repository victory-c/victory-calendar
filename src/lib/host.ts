// The one place that knows the public host. Swap PUBLIC_HOST when the custom domain exists.
export function publicHost(): string {
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL) return process.env.VERCEL_BRANCH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return 'localhost:3000';
}

export function publicOrigin(): string {
  const host = publicHost();
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return `${local ? 'http' : 'https'}://${host}`;
}
