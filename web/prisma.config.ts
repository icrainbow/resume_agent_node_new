import { defineConfig } from "prisma/config";

export default defineConfig({
  migrate: {
    // Used by Prisma Migrate / introspection
    url: process.env.DATABASE_URL,
  },
});
