// web/lib/db/client.ts
// PrismaClient singleton for Next.js (prevents multiple instances in dev mode)

import { PrismaClient } from "@prisma/client";

// Extend global type to cache PrismaClient in development
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Singleton pattern: reuse client in development (hot reload safe)
export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
