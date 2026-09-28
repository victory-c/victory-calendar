import { sendEmail } from './send';

// Bilingual, plain, no marketing. Expires in 5 minutes (auth.ts).
export async function sendMagicLink(email: string, url: string) {
  const text = [
    "Sign in to Victor's Picks admin / 登录 Victor 精选后台:",
    url,
    '',
    'This link expires in 5 minutes. 链接 5 分钟内有效。',
    "If you didn't ask for it, ignore this email. 如果不是你本人操作，请忽略。",
  ].join('\n');
  const html = `<p>Sign in to Victor's Picks admin / 登录 Victor 精选后台:</p>
<p><a href="${url}">${url}</a></p>
<p style="color:#6b7280">This link expires in 5 minutes. 链接 5 分钟内有效。</p>`;
  await sendEmail({ to: email, subject: "Sign in · 登录 · Victor's Picks", html, text });
}
