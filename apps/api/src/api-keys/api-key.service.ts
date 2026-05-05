import { DispatchError } from '@dispatch/shared';
import { generateApiKey } from '../auth/auth.crypto.js';
import { auditLog } from '../audit/audit.service.js';
import { ApiKeyRepository } from './api-key.repository.js';

export class ApiKeyService {
  constructor(private apiKeyRepo: ApiKeyRepository) {}

  async createApiKey(tenantId: string, userId: string, name: string, expiresAt?: string) {
    const { raw, hash } = generateApiKey();

    const apiKey = await this.apiKeyRepo.create({
      tenantId,
      name,
      keyHash: hash,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: apiKey.id,
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      key: raw,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  async listApiKeys(tenantId: string, limit: number) {
    const [items, total] = await Promise.all([
      this.apiKeyRepo.findMany(tenantId, limit),
      this.apiKeyRepo.count(tenantId),
    ]);

    return { items, total };
  }

  async revokeApiKey(tenantId: string, userId: string, id: string) {
    const existing = await this.apiKeyRepo.findFirst(tenantId, id);
    if (!existing) throw new DispatchError('NOT_FOUND', 'API key not found', 404);

    await this.apiKeyRepo.delete(tenantId, id);

    await auditLog({
      tenantId,
      actorId: userId,
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
    });
  }
}
