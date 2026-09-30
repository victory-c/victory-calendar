import { Suspense } from 'react';
import { Screen } from '@/components/admin/ui';
import { requireAdmin } from '@/lib/admin-session';

export const metadata = { title: 'Inbox' };

async function Inbox() {
  await requireAdmin();
  return (
    <p className="py-10 text-center text-muted">
      Candidates from your calendars arrive here with the inbox (M2 week 11).
      <br />
      日历里的候选活动会在第 11 周接入后出现在这里。
    </p>
  );
}

export default function InboxPage() {
  return (
    <Screen title="Inbox · 收件箱">
      <Suspense>
        <Inbox />
      </Suspense>
    </Screen>
  );
}
