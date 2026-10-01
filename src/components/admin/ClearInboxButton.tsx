'use client';
import { useState, useTransition } from 'react';
import { clearInboxData } from '@/app/admin/inbox-actions';
import { btn } from './ui';

/** Settings「清空收件箱数据」: asks once, then deletes every candidate and feed status row. */
export function ClearInboxButton() {
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={btn.danger}
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Delete every inbox candidate? Added events stay. · 清空全部候选？已添加的活动不受影响。')) return;
          start(async () => setMsg((await clearInboxData())?.message ?? ''));
        }}
      >
        Clear inbox data · 清空收件箱数据
      </button>
      <span role="status" aria-live="polite" className="text-sm text-muted">{pending ? '…' : msg}</span>
    </div>
  );
}
