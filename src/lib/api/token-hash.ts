import { createHash, randomBytes } from 'node:crypto';

// Plain helpers shared by the server module and scripts/token.ts (which can't import server-only).
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const generateToken = () => `vp_${randomBytes(32).toString('base64url')}`;
