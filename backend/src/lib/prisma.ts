import { PrismaClient } from "@prisma/client";

/**
 * Prisma Client 單例。
 * 在開發模式下 (ts-node / next dev 的 HMR) 重複 new PrismaClient()
 * 會耗盡資料庫連線，因此掛在 globalThis 上重用。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
