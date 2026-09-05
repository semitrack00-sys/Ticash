import { PrismaClient } from '@prisma/client';

export const databaseEnabled =
  process.env.NODE_ENV !== 'test' && Boolean(process.env.DATABASE_URL);

export const prisma = new PrismaClient();

export async function connectDatabase() {
  if (databaseEnabled) await prisma.$connect();
}

export async function disconnectDatabase() {
  if (databaseEnabled) await prisma.$disconnect();
}
