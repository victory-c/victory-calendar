'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function PasskeyPanel() {
  const router = useRouter();
  const [msg, setMsg] = useState('');
  async function add() {
    const res = await authClient.passkey.addPasskey({ name: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Mac' });
    setMsg(res?.error ? (res.error.message ?? 'Failed · 失败') : 'Passkey added · 已添加通行密钥');
  }
  async function signOut() {
    await authClient.signOut();
    router.replace('/admin/sign-in');
    router.refresh();
  }
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <button type="button" onClick={add} className="h-11 rounded-full bg-ink px-5 text-paper">
        Add passkey on this device · 在本设备添加通行密钥
      </button>
      <button type="button" onClick={signOut} className="h-11 rounded-full border border-rule px-5">
        Sign out · 退出
      </button>
      <p role="status" aria-live="polite" className="w-full text-sm text-muted">
        {msg}
      </p>
    </div>
  );
}
