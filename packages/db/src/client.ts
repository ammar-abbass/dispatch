import { PrismaClient } from './generated/client/client.js';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

/** Mutable prisma singleton — use setPrisma() in tests to override */
export let prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

/** Override the prisma singleton (for test containers) */
export function setPrisma(client: PrismaClient): void {
  prisma = client;
  globalForPrisma.prisma = client;
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
