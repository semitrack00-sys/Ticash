import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();

export const databaseEnabled =
  process.env.NODE_ENV !== 'test' && Boolean(configuredDatabaseUrl);

function normalizeVerifiedTls(connectionString: string) {
  const url = new URL(connectionString);

  // node-postgres currently treats `require` as full certificate and hostname
  // verification, but its next major version will use weaker libpq semantics.
  // Make the intended verification level explicit without changing the value
  // developers receive from Neon.
  if (url.searchParams.get('sslmode') === 'require') {
    url.searchParams.set('sslmode', 'verify-full');
  }

  return url.toString();
}

export const prisma = databaseEnabled
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: normalizeVerifiedTls(configuredDatabaseUrl!),
      }),
    })
  : new PrismaClient();

export async function connectDatabase() {
  if (databaseEnabled) await prisma.$connect();
}

export async function disconnectDatabase() {
  if (databaseEnabled) await prisma.$disconnect();
}
