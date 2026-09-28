import { SignInForm } from '@/components/admin/SignInForm';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-h2">Victor&apos;s Picks · 后台</h1>
      <SignInForm />
    </main>
  );
}
