'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'sent' } | { kind: 'error'; message: string };

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function passkeySignIn() {
    setState({ kind: 'busy' });
    const res = await authClient.signIn.passkey();
    if (res?.error) return setState({ kind: 'error', message: res.error.message ?? 'Passkey failed · 通行密钥失败' });
    router.replace('/admin');
    router.refresh();
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'busy' });
    const res = await authClient.signIn.magicLink({ email, callbackURL: '/admin' });
    if (res.error) return setState({ kind: 'error', message: res.error.message ?? 'Not allowed · 无权限' });
    setState({ kind: 'sent' });
  }

  return (
    <div className="mt-8 space-y-8">
      <button
        type="button"
        onClick={passkeySignIn}
        disabled={state.kind === 'busy'}
        className="h-11 w-full rounded-full bg-ink px-5 text-paper disabled:opacity-60"
      >
        Sign in with passkey · 用通行密钥登录
      </button>

      <form onSubmit={magicLink} className="space-y-3 border-t border-rule pt-6">
        <label htmlFor="email" className="block text-sm text-muted">
          First time on this device? Email link · 首次登录用邮件链接
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email webauthn"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 w-full rounded-lg border border-rule bg-paper px-3"
        />
        <button
          type="submit"
          disabled={state.kind === 'busy'}
          className="h-11 w-full rounded-full border border-rule px-5 disabled:opacity-60"
        >
          Send link · 发送链接
        </button>
      </form>

      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {state.kind === 'sent' && 'Check your inbox · 请查收邮件'}
        {state.kind === 'error' && <span className="text-seal-text">{state.message}</span>}
      </p>
    </div>
  );
}
