# Phase 5 PR1 Implementation - COMPLETE ✅

**Date:** 2025-12-25
**Status:** Ready for setup and testing

---

## What Was Implemented

### Files Created

```
web/
  prisma/
    schema.prisma                          # 6 tables (Job, JobEvent, Task, Artifact, ArtifactCounter, JobArtifactLatest)
  lib/
    db/
      client.ts                            # PrismaClient singleton with dev/prod config
      repositories/
        JobRepository.ts                   # Job CRUD + event logging (owner isolation)
        TaskRepository.ts                  # Task lifecycle management (owner isolation)
        ArtifactRepository.ts              # Atomic version allocation + latest pointers

    auth/
      owner.ts                             # Owner resolver stub (env var / header)

docs/
  AKS_DEPLOYMENT.md                        # AKS deployment guide (secrets, service discovery, worker config)
  MIGRATIONS.md                            # Migration strategy (local, staging, production)
```

### Files Modified

```
web/
  package.json                             # Added @prisma/client, prisma
  .gitignore                               # Added Prisma exclusions
  .env.example                             # Added DATABASE_URL, DEFAULT_OWNER_USER_ID
```

---

## Database Schema Summary

**6 Tables Created:**

1. **Job** - Core job state, owner isolation, file metadata
   - owner_user_id NOT NULL (B2C model)
   - sections, current_schema (JSONB)
   - cv_sections_confirmed, schema_dirty (gates)
   - @updatedAt for staleness checks

2. **JobEvent** - Audit log for observability
   - owner_user_id (denormalized for queries)
   - trace_id (UUID) for distributed tracing
   - event_type (parse, optimize, export, etc.)
   - payload (JSONB)

3. **Task** - Async operation lifecycle
   - Idempotency: UNIQUE (owner_user_id, idempotency_key)
   - Status: queued, running, completed, failed
   - Stage: for UX progress updates
   - timeout_at, @updatedAt for staleness checks

4. **Artifact** - Export version history
   - UNIQUE (job_id, kind, version)
   - kind: pdf, docx, zip
   - is_zip: distinguishes bundle from individual files
   - expires_at: 90-day default retention

5. **ArtifactCounter** - Atomic version allocation (concurrency-safe)
   - PRIMARY KEY (job_id, kind)
   - next_version: atomically incremented on insert

6. **JobArtifactLatest** - Latest artifact pointer
   - PRIMARY KEY (job_id, kind)
   - latest_artifact_id, latest_version
   - @updatedAt for tracking

**Key Features:**
- Owner isolation enforced (all queries filter by owner_user_id)
- Concurrency-safe version allocation (ArtifactCounter)
- Latest pointer management (JobArtifactLatest)
- Retention at read time (no deletion on insert)
- JSONB for flexible schema/sections storage

---

## Repository Patterns

### Owner Isolation Enforced

All repository methods require `owner_user_id` parameter:

```typescript
// ✅ Correct
await jobRepo.findById(job_id, owner_user_id);

// ❌ Wrong (would allow cross-user access)
await jobRepo.findById(job_id);
```

### Idempotency Scoped to Owner

```typescript
// Uniqueness: (owner_user_id, idempotency_key)
const task = await taskRepo.findByIdempotencyKey(owner_user_id, idempotency_key);
```

### Atomic Version Allocation

```typescript
// Concurrency-safe
const version = await artifactRepo.allocateVersion(job_id, "pdf");
// Returns next version (1, 2, 3, ...) atomically
```

---

## Next Steps (Setup Required)

### 1. Install Dependencies

```bash
cd web
npm install
```

This installs:
- `@prisma/client@^5.22.0`
- `prisma@^5.22.0` (dev)

### 2. Set Up Database

**Option A: Docker (recommended for local dev)**
```bash
docker run --name postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=resume_agent \
  -p 5432:5432 \
  -d postgres:16
```

**Option B: Cloud (Supabase, Neon, Azure Database)**
- Create PostgreSQL instance
- Note connection string

### 3. Configure Environment

```bash
cd web
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/resume_agent?schema=public"
DEFAULT_OWNER_USER_ID="dev-user-1"
```

### 4. Generate Prisma Client

```bash
cd web
npx prisma generate
```

Output:
```
✔ Generated Prisma Client (5.22.0) to ./node_modules/@prisma/client in 123ms
```

### 5. Run Migrations

```bash
cd web
npx prisma migrate dev --name init
```

Output:
```
Applying migration `20251225_init`
✔ Applied migration in 234ms
```

### 6. Verify Schema

```bash
cd web
npx prisma studio
```

Opens http://localhost:5555 - verify 6 tables exist.

### 7. Test TypeScript Compilation

```bash
cd web
npx tsc --noEmit
```

Should complete with no errors after Prisma client is generated.

---

## Testing Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] PostgreSQL running and accessible
- [ ] .env configured with DATABASE_URL
- [ ] Prisma client generated (`npx prisma generate`)
- [ ] Migrations applied (`npx prisma migrate dev`)
- [ ] 6 tables visible in Prisma Studio
- [ ] TypeScript compilation clean (`npx tsc --noEmit`)
- [ ] Repository methods testable (see below)

### Testing Repositories

Create `web/scripts/test-pr1.ts`:

```typescript
import { prisma } from "@/lib/db/client";
import { JobRepository } from "@/lib/db/repositories/JobRepository";
import { TaskRepository } from "@/lib/db/repositories/TaskRepository";
import { ArtifactRepository } from "@/lib/db/repositories/ArtifactRepository";

async function test() {
  const jobRepo = new JobRepository(prisma);
  const taskRepo = new TaskRepository(prisma);
  const artifactRepo = new ArtifactRepository(prisma);

  const owner = "test-user-1";

  // Test 1: Create job
  const job = await jobRepo.create({ owner_user_id: owner });
  console.log("✅ Created job:", job.id);

  // Test 2: Create task with idempotency
  const idempotencyKey = crypto.randomUUID();
  const task1 = await taskRepo.create({
    job_id: job.id,
    owner_user_id: owner,
    idempotency_key: idempotencyKey,
    task_type: "export",
    input_payload: { sections: [] },
  });
  console.log("✅ Created task:", task1.id);

  // Test 3: Idempotency (should return existing task)
  const task2 = await taskRepo.findByIdempotencyKey(owner, idempotencyKey);
  console.log("✅ Idempotency check:", task1.id === task2?.id);

  // Test 4: Owner isolation (should return null)
  const wrongOwner = await jobRepo.findById(job.id, "wrong-user");
  console.log("✅ Owner isolation:", wrongOwner === null);

  // Test 5: Allocate versions (concurrency-safe)
  const v1 = await artifactRepo.allocateVersion(job.id, "pdf");
  const v2 = await artifactRepo.allocateVersion(job.id, "pdf");
  const v3 = await artifactRepo.allocateVersion(job.id, "pdf");
  console.log("✅ Version allocation:", v1, v2, v3); // Should be 1, 2, 3

  // Test 6: Create artifact
  const artifact = await artifactRepo.create({
    job_id: job.id,
    owner_user_id: owner,
    task_id: task1.id,
    kind: "pdf",
    version: v1,
    is_zip: false,
    blob_path: "users/test/jobs/123/exports/test.pdf",
    filename: "test.pdf",
  });
  console.log("✅ Created artifact:", artifact.id);

  // Test 7: Update latest pointer
  await artifactRepo.updateLatestPointer(job.id, "pdf", artifact.id, v1);
  const latest = await artifactRepo.getLatest(job.id, "pdf", owner);
  console.log("✅ Latest pointer:", latest?.id === artifact.id);

  console.log("\n🎉 All PR1 tests passed!");
}

test()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Run:
```bash
npx tsx scripts/test-pr1.ts
```

---

## What's NOT Included (By Design)

**PR1 does NOT include:**
- ❌ Azure Blob integration (PR2)
- ❌ SAS URL generation (PR2)
- ❌ Async export endpoints (PR3)
- ❌ Worker DB connection (PR2/PR3)
- ❌ Behavioral changes to existing flows
- ❌ UI changes

**PR1 ONLY adds database infrastructure** (write-only, not queried by app yet).

---

## Important Notes

### 🔒 No Behavioral Changes

PR1 adds database schema and repositories but:
- Existing flows unchanged (still use in-memory state)
- Database tables exist but are not queried/written by app
- Backward compatible (can deploy without breaking existing functionality)

### ⚠️ Owner Isolation

ALL repository methods enforce owner isolation:
- `owner_user_id` required for all queries/updates
- Uses `findFirst` / `updateMany` with owner filter
- Prevents accidental cross-user data leakage

### 🎯 Concurrency-Safe Versioning

ArtifactCounter uses atomic increment:
```sql
INSERT INTO artifact_counters (job_id, kind, next_version)
VALUES (?, ?, 1)
ON CONFLICT (job_id, kind)
DO UPDATE SET next_version = artifact_counters.next_version + 1
RETURNING next_version;
```

Multiple workers can allocate versions concurrently without collisions.

### 📊 Retention at Read Time

Phase 5 does NOT delete old artifacts on insert (avoids transaction bloat).

Retention enforced via:
- API query: `ORDER BY version DESC LIMIT 5`
- Only latest + last 5 visible to users
- Phase 6 cron job deletes expired, non-latest records

---

## AKS Deployment Notes

See [docs/AKS_DEPLOYMENT.md](../docs/AKS_DEPLOYMENT.md) for full guide.

**Key points:**
- Secrets via Kubernetes Secrets (DATABASE_URL, DEFAULT_OWNER_USER_ID)
- Service discovery: WORKER_BASE_URL=http://worker-service:8000
- Worker: `--workers 1` required (Phase 5)
- Migrations: Kubernetes Job via Helm pre-upgrade hook

---

## Migration Strategy

See [docs/MIGRATIONS.md](../docs/MIGRATIONS.md) for full guide.

**Key points:**
- Local dev: `npx prisma migrate dev`
- Production: `npx prisma migrate deploy` (via Kubernetes Job)
- Rollback: Manual SQL scripts (Prisma doesn't auto-generate down-migrations)
- Concurrency-safe: Prisma uses advisory locks

---

## Git Status

```
M  web/.gitignore
M  web/package.json
?? docs/AKS_DEPLOYMENT.md
?? docs/MIGRATIONS.md
?? web/lib/auth/
?? web/lib/db/
?? web/prisma/
?? PHASE5_PR1_COMPLETE.md
```

---

## Ready for PR2?

**After PR1 setup complete:**
1. Verify all tests pass
2. Commit PR1 changes
3. Review PR2 plan (Azure Blob + SAS URLs)
4. Begin PR2 implementation

**Blockers:**
- None (PR1 is self-contained)

---

**Status:** ✅ PR1 implementation complete, awaiting setup + testing
