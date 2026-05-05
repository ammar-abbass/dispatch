import { createHash, randomBytes } from 'node:crypto';

/**
 * Hash a high-entropy token with SHA-256.
 * Used for API keys and refresh tokens — not for passwords.
 * bcrypt is not appropriate here because these tokens are already high-entropy (256-bit random).
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a cryptographically secure API key.
 * Returns base64url-encoded bytes prefixed with `atk_`.
 * The raw key is shown to the user once; only the SHA-256 hash is stored.
 */
export function generateApiKey(): { raw: string; hash: string } {
  const raw = `atk_${randomBytes(32).toString('base64url')}`;
  return { raw, hash: sha256(raw) };
}

/**
 * Generate a cryptographically secure refresh token.
 * Returns the raw token (stored in httpOnly cookie) and its SHA-256 hash (stored in DB).
 */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(40).toString('base64url');
  return { raw, hash: sha256(raw) };
}
