import bcryptjs from 'bcryptjs';
import { prisma } from '@dispatch/db';
import { DispatchError } from '@dispatch/shared';

export class UserService {
  static async createUser(
    tenantId: string,
    email: string,
    password: string,
    role: 'admin' | 'operator' | 'viewer'
  ) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new DispatchError('CONFLICT_ERROR', 'User with this email already exists', 409);
    }

    const passwordHash = await bcryptjs.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash,
        role,
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        tenantId: true,
      },
    });

    return user;
  }
}
