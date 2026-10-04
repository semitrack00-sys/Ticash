import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string;
  firstName?: string;
  lastName?: string;
};

let cached: { expiresAt: number; keys: Array<Record<string, unknown>> } | undefined;

export async function verifyGoogleIdentity(idToken: string, audience: string): Promise<VerifiedGoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length > 12000)) throw new Error('Invalid Google credential');
  const decode = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
  const header = decode(parts[0]!);
  const claims = decode(parts[1]!);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid Google credential');

  if (!cached || cached.expiresAt <= Date.now()) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Google keys unavailable');
    const body = await response.json() as { keys?: Array<Record<string, unknown>> };
    if (!Array.isArray(body.keys)) throw new Error('Google keys unavailable');
    const maxAge = /max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')?.[1];
    cached = { keys: body.keys, expiresAt: Date.now() + Math.min(3600, Number(maxAge ?? 300)) * 1000 };
  }

  const jwk = cached.keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    cached = undefined;
    throw new Error('Unknown Google signing key');
  }

  const valid = verifySignature(
    'RSA-SHA256',
    Buffer.from(parts[0] + '.' + parts[1]),
    createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' }),
    Buffer.from(parts[2]!, 'base64url'),
  );
  const now = Math.floor(Date.now() / 1000);
  if (
    !valid ||
    claims.aud !== audience ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss)) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    typeof claims.sub !== 'string' ||
    claims.sub.length > 255 ||
    typeof claims.email !== 'string' ||
    claims.email_verified !== true
  ) throw new Error('Invalid Google credential');

  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    firstName: typeof claims.given_name === 'string' ? claims.given_name : undefined,
    lastName: typeof claims.family_name === 'string' ? claims.family_name : undefined,
  };
}
