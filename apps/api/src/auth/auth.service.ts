import bcryptjs from 'bcryptjs';
import { prisma } from '@dispatch/db';
import { DispatchError } from '@dispatch/shared';
import { generateRefreshToken, sha256 } from './auth.crypto.js';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

export class AuthService {
  static async login(
    email: string,
    password: string,
  ): Promise<{ user: any; rawRefreshToken: string }> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new DispatchError('AUTHENTICATION_ERROR', 'Invalid credentials', 401);
    }

    const valid = await bcryptjs.compare(password, user.passwordHash);
    if (!valid) {
      throw new DispatchError('AUTHENTICATION_ERROR', 'Invalid credentials', 401);
    }

    const { raw, hash } = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { user, rawRefreshToken: raw };
  }

  static async signup(
    email: string,
    password: string,
    tenantName: string,
  ): Promise<{ user: any; rawRefreshToken: string }> {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new DispatchError('CONFLICT_ERROR', 'User with this email already exists', 409);
    }

    const passwordHash = await bcryptjs.hash(password, 10);

    // Create tenant and user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const slug = tenantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const tenant = await tx.tenant.create({
        data: { name: tenantName, slug },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          role: 'admin',
        },
      });

      const { raw, hash } = generateRefreshToken();
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      });

      return { user, rawRefreshToken: raw };
    });

    return result;
  }

  static async refresh(
    rawRefreshToken: string,
  ): Promise<{ user: any; newRawRefreshToken: string }> {
    const hash = sha256(rawRefreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new DispatchError('AUTHENTICATION_ERROR', 'Refresh token is invalid or expired', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      throw new DispatchError('AUTHENTICATION_ERROR', 'User not found', 401);
    }

    // Rotate: revoke old, issue new
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { raw: newRaw, hash: newHash } = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { user, newRawRefreshToken: newRaw };
  }

  static async logout(rawRefreshToken: string): Promise<void> {
    const hash = sha256(rawRefreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  static getAccessTokenTtlSeconds(): number {
    return ACCESS_TOKEN_TTL_SECONDS;
  }

  static getRefreshTokenTtlMs(): number {
    return REFRESH_TOKEN_TTL_MS;
  }
}
