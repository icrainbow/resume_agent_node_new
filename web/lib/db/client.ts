// web/lib/db/client.ts
// PrismaClient singleton for Next.js (prevents multiple instances in dev mode)

// Use type-only import so TS knows the shape,
// and runtime require so Node resolves correctly regardless of TS "exports" quirks.
import type { PrismaClient as PrismaClientType } from "@prisma/client";

const { PrismaClient } = require("@prisma/client") as {
  PrismaClient: new (...args: any[]) => PrismaClientType;
};

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientType | undefined;
}

// Singleton pattern: reuse client in development (hot reload safe)
export const prisma: PrismaClientType =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

export default prisma;
