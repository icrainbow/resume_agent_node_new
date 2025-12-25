# Phase 5 PR1 Setup Instructions

**Status:** Code complete, awaiting setup and testing
**Date:** 2025-12-25

## What Was Done

✅ **Files Added:**
- `web/prisma/schema.prisma` - Database schema (Job, JobEvent, Task, ExportVersion)
- `web/lib/db/client.ts` - PrismaClient singleton
- `web/lib/db/repositories/JobRepository.ts` - Job CRUD operations
- `web/lib/db/repositories/TaskRepository.ts` - Task CRUD operations
- `web/.env.example` - Environment variable template

✅ **Files Modified:**
- `web/package.json` - Added `@prisma/client` + `prisma` (dev)
- `web/.gitignore` - Added Prisma artifacts exclusions

## Next Steps (Required Before Use)

### 1. Install Dependencies

```bash
cd web
npm install
```

This will install:
- `@prisma/client@^5.22.0` (runtime)
- `prisma@^5.22.0` (CLI, dev dependency)

### 2. Set Up Environment Variables

Create `web/.env` (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `web/.env` and set your PostgreSQL connection string:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/resume_agent?schema=public"
```

**For local development:**
- Use Docker: `docker run --name postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=resume_agent -p 5432:5432 -d postgres:16`
- Or use local PostgreSQL installation
- Or use cloud service (Supabase, Neon, Azure Database for PostgreSQL)

### 3. Generate Prisma Client

```bash
cd web
npx prisma generate
```

This generates TypeScript types from `schema.prisma` into `node_modules/@prisma/client`.

### 4. Run Database Migrations

**Development (creates migration + applies it):**
```bash
cd web
npx prisma migrate dev --name init
```

This will:
- Create `prisma/migrations/YYYYMMDDHHMMSS_init/migration.sql`
- Apply migration to your database
- Create tables: `Job`, `JobEvent`, `Task`, `ExportVersion`

**Production (applies existing migrations):**
```bash
cd web
npx prisma migrate deploy
```

### 5. Verify Setup

**Check TypeScript compilation:**
```bash
cd web
npx tsc --noEmit
```

Should output: **No errors** ✅

**Inspect database schema:**
```bash
cd web
npx prisma studio
```

Opens browser UI at `http://localhost:5555` to view/edit database.

### 6. Test Repositories (Optional)

Create a test script `web/scripts/test-repositories.ts`:

```typescript
import { prisma } from "@/lib/db/client";
import { JobRepository } from "@/lib/db/repositories/JobRepository";
import { TaskRepository } from "@/lib/db/repositories/TaskRepository";

async function test() {
  const jobRepo = new JobRepository(prisma);
  const taskRepo = new TaskRepository(prisma);

  // Create a job
  const job = await jobRepo.create({ owner_user_id: "dev-user-1" });
  console.log("Created job:", job.id);

  // Create a task
  const task = await taskRepo.create({
    job_id: job.id,
    idempotency_key: crypto.randomUUID(),
    task_type: "export",
    input_payload: { sections: [] },
  });
  console.log("Created task:", task.id);

  // Query back
  const foundJob = await jobRepo.findById(job.id);
  console.log("Found job:", foundJob?.id);

  const foundTask = await taskRepo.findById(task.id);
  console.log("Found task:", foundTask?.id);

  console.log("✅ All tests passed!");
}

test()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Run:
```bash
cd web
npx tsx scripts/test-repositories.ts
```

## Schema Overview

### Jobs Table
- `id` (UUID, primary key)
- `owner_user_id` (NOT NULL) - User who owns this job
- `tenant_id` (NULLABLE) - Optional multi-tenancy support
- `resume_filename`, `resume_blob_path` - Resume file metadata
- `schema_filename`, `schema_blob_path` - Schema file metadata
- `jd_filename`, `jd_blob_path`, `jd_text` - Job description metadata
- `current_schema` (JSONB) - Current parsed schema
- `sections` (JSONB) - Array of Section objects
- `cv_sections_confirmed` (Boolean) - Confirmation gate
- `schema_dirty` (Boolean) - Dirty flag for schema changes
- `created_at`, `updated_at` (Timestamps)

### JobEvent Table (Audit Log)
- `id` (BigInt, auto-increment)
- `job_id` (UUID, foreign key → Job)
- `trace_id` (UUID, nullable) - For distributed tracing
- `event_type` (String) - "parse", "optimize", "export", etc.
- `payload` (JSONB) - Event-specific data
- `created_at` (Timestamp)

### Task Table (Async Operations)
- `id` (UUID, primary key)
- `job_id` (UUID, foreign key → Job)
- `idempotency_key` (UUID, UNIQUE) - Prevent duplicate tasks
- `task_type` (String) - "export", "optimize_all"
- `status` (String) - "pending", "running", "completed", "failed"
- `input_payload` (JSONB) - Snapshot of input at creation
- `output_payload` (JSONB, nullable) - Result data
- `error_message` (Text, nullable) - Error details
- `heartbeat_at`, `started_at`, `completed_at` (Timestamps)
- `created_at` (Timestamp)

### ExportVersion Table (Version History)
- `id` (BigInt, auto-increment)
- `job_id` (UUID)
- `version` (Int) - Auto-increment per job
- `pdf_blob_path`, `docx_blob_path` (Strings)
- `created_at` (Timestamp)

## Important Notes

### ⚠️ NO Behavioral Changes in PR1

This PR **only** adds database infrastructure. The application **does NOT** use the database yet. State is still ephemeral in memory.

**PR2** will wire up the repositories to API routes for observability (trace_id, job_events).

**PR3** will add async export using the Task table and Azure Blob Storage.

### 🔒 Security

- `.env` is gitignored (never commit credentials)
- Use environment-specific DATABASE_URL (dev, staging, prod)
- For production: Use connection pooling (PgBouncer or Prisma Accelerate)

### 🚀 Deployment Checklist

Before deploying to staging/production:

1. ✅ Set `DATABASE_URL` in environment
2. ✅ Run `npx prisma migrate deploy` (applies migrations)
3. ✅ Run `npx prisma generate` (generates client)
4. ✅ Verify TypeScript compilation (`npx tsc --noEmit`)
5. ✅ Test database connectivity (`npx prisma studio`)

### 🔄 Rollback Plan

If PR1 causes issues:
1. Revert code changes
2. Database tables remain but unused (safe to keep or drop)
3. No user-facing impact (database not queried yet)

## Troubleshooting

**Error: "Cannot find module '@prisma/client'"**
- Run: `npm install` and `npx prisma generate`

**Error: "Database connection failed"**
- Check `DATABASE_URL` in `.env`
- Verify PostgreSQL is running: `pg_isready`
- Test connection: `npx prisma db pull`

**Error: "Migration failed"**
- Check PostgreSQL logs
- Ensure user has CREATE TABLE permissions
- Try: `npx prisma migrate reset` (WARNING: deletes all data)

**Error: TypeScript compilation errors**
- Run: `npx prisma generate` (regenerates types)
- Run: `npm install` (ensures dependencies installed)

## What's Next (PR2 Preview)

PR2 will add:
- `trace_id` propagation (Web → Worker)
- Structured logging in worker
- Wire up `JobRepository.logEvent()` in API routes
- Worker PostgreSQL connection (psycopg2)
- **Still no functional changes** (just observability)

---

**Status:** ✅ PR1 code complete, ready for `npm install` + Prisma setup
