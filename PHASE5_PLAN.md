# Phase 5 Implementation Plan: PostgreSQL + Azure Blob + Async Export

**Version:** Phase 5 Draft
**Date:** 2025-12-25
**Mode:** PLAN ONLY (no code changes until approved)
**Status:** Awaiting user approval

---

## Executive Summary

**Goal:** Add persistent storage (PostgreSQL + Azure Blob), observability (trace_id), and async export without breaking existing synchronous flows.

**Strategy:** 3 sequential PRs, strict backward compatibility, fail-closed fallbacks.

**Non-Goals:**
- Authentication/authorization (out of scope)
- Multi-tenancy enforcement (B2C model: tenant_id NULLABLE)
- Worker queue system (deferred to Phase 6)
- Frontend UI redesign (minimal changes only)

---

## Repo Reconnaissance

### Current State

**No database layer:**
- `web/`: Next.js 14, TypeScript, no Prisma (yet)
- `worker-py/`: FastAPI, Python, no DB connection (yet)
- State ephemeral: `State` type in `web/app/automode/_hooks/_controller/types.ts`
- Job ID: Random hex string (`newJobId()` in `controller_helpers.ts`)
- Files: Local filesystem (`worker-py/outputs/{job_id}/`)

**Key Files:**
```
web/
  app/
    api/
      export/route.ts         # Synchronous export proxy (MUST NOT CHANGE)
      download/route.ts       # Download proxy (Phase 4)
      agent/route.ts          # Agent orchestrator
    automode/
      _hooks/_controller/
        types.ts              # State/Action/Section contracts
        actions/export.ts     # Export action (client-side)
        job.ts                # ensureJobId(), newJobId()

worker-py/
  src/
    app.py                    # FastAPI endpoints (parse, optimize, export)
    core.py                   # LLM integration
    utils_sections.py         # Export generation
  outputs/                    # Generated files (will move to Blob)
  requirements.txt
```

**Dependencies:**
- `web/package.json`: No Prisma yet, no PostgreSQL client
- `worker-py/requirements.txt`: No psycopg2/SQLAlchemy yet

---

## Architecture Decisions

### 1. Database: PostgreSQL

**Why PostgreSQL:**
- ACID transactions for job state consistency
- JSON/JSONB for flexible schema storage
- Mature ecosystem (Prisma, psycopg2)
- Easy to host (Azure Database for PostgreSQL)

**Connection Model:**
- **Web (Next.js):** Prisma ORM
  - Read-only queries (fetch job state for UI)
  - Write jobs/tasks (create new jobs)
  - NO optimization/export writes (handled by worker)

- **Worker (Python):** Direct PostgreSQL connection (psycopg2)
  - Writes job_events, updates task status
  - Updates job.updated_at on every operation
  - NO Prisma dependency (keeps worker lightweight)

**Why not worker → web callback?**
- Coupling: Worker should not know web's URL
- Reliability: Callback failures would block worker
- Simplicity: Direct DB writes are deterministic

---

### 2. Storage: Azure Blob Storage

**Why Azure Blob:**
- Cost-effective for file storage
- SAS URLs for secure, time-limited access
- Versioning built-in
- Easy CDN integration (future)

**SAS URL Strategy:**
- **Generated on-demand** by web API routes
- **TTL: 45 minutes** (user download window)
- **NEVER persisted** in database (only blob_path stored)
- **Rotation-safe:** No long-lived credentials in DB

**Blob Naming:**
```
{job_id}/exports/{timestamp}_Resume.pdf
{job_id}/exports/{timestamp}_Resume.docx
{job_id}/inputs/resume.pdf
{job_id}/inputs/schema.json
{job_id}/inputs/jd.txt
```

**Retention Policy:**
- Keep N=5 most recent versions per job
- Cleanup after 90 days (blob lifecycle policy)
- Soft-delete enabled (30-day recovery)

---

### 3. Observability: trace_id

**Why trace_id:**
- Correlate logs across web/worker/LLM
- Debug multi-step flows (parse → optimize → export)
- Support future distributed tracing (OpenTelemetry)

**Propagation:**
```
Browser → Next.js API (generates trace_id)
         → Worker (receives via X-Trace-ID header)
         → LLM calls (tagged in prompt metadata)
```

**Format:** UUID v4 (standard, unique, sortable)

**Logging:**
- Web: `console.log` with `[trace_id=...]` prefix (dev mode only)
- Worker: Structured JSON logs with `trace_id` field
- Database: `job_events.trace_id` for query correlation

---

### 4. Async Export

**Why async:**
- Export can take 10-30 seconds (LLM + rendering)
- Current synchronous flow blocks UI, risks timeout
- Enables progress updates (future)

**Design:**
- **Existing `/api/export`:** UNCHANGED (synchronous, backward compatible)
- **New `/api/tasks/export`:** POST → returns task_id (202 Accepted)
- **New `/api/tasks/:task_id`:** GET → poll for completion

**Task Lifecycle:**
1. Client: POST `/api/tasks/export` with idempotency_key
2. Web: Insert task row (status=pending), return task_id
3. Worker: Polls DB for pending tasks, picks one
4. Worker: Executes export, updates task.status=completed
5. Client: GET `/api/tasks/:task_id` → status=completed, blob URLs
6. Client: Requests download with SAS URL

**Idempotency:**
- Client sends `idempotency_key` (UUID v4)
- Web checks `tasks` table: if key exists, return existing task
- Prevents duplicate exports on retry

**Heartbeat:**
- Worker updates `task.heartbeat_at` every 5 seconds
- If heartbeat stale >60s, task considered failed
- Client shows "Worker unresponsive" error

---

## PR Breakdown

### PR1: PostgreSQL Schema + Prisma Migrations + Repository Layer

**Goal:** Add database schema, Prisma setup, repository interfaces, NO behavioral changes.

**Scope:** Web only (worker in PR2).

#### Files Added

```
web/
  prisma/
    schema.prisma           # Prisma schema definition
    migrations/
      20251225_init/
        migration.sql       # Initial schema SQL
  lib/
    db/
      client.ts             # PrismaClient singleton
      repositories/
        JobRepository.ts    # Job CRUD operations
        TaskRepository.ts   # Task CRUD operations
  .env.example              # Add DATABASE_URL, AZURE_STORAGE_*
```

#### Files Modified

```
web/
  package.json              # Add @prisma/client, prisma (dev)
  .gitignore                # Add .env, prisma/dev.db
```

#### Database Schema (Prisma)

```prisma
// web/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// B2C model: owner_user_id NOT NULL, tenant_id NULLABLE
model Job {
  id                 String    @id @default(uuid()) @db.Uuid
  owner_user_id      String    @db.VarChar(255)
  tenant_id          String?   @db.VarChar(255)

  // Core data
  resume_filename    String?   @db.VarChar(512)
  resume_blob_path   String?   @db.VarChar(1024)
  schema_filename    String?   @db.VarChar(512)
  schema_blob_path   String?   @db.VarChar(1024)
  jd_filename        String?   @db.VarChar(512)
  jd_blob_path       String?   @db.VarChar(1024)
  jd_text            String?   @db.Text

  current_schema     Json?     @db.JsonB
  sections           Json?     @db.JsonB  // Array<Section>

  // Gates
  cv_sections_confirmed Boolean @default(false)
  schema_dirty          Boolean @default(false)

  // Metadata
  created_at         DateTime  @default(now()) @db.Timestamptz
  updated_at         DateTime  @updatedAt @db.Timestamptz

  // Relations
  events             JobEvent[]
  tasks              Task[]

  @@index([owner_user_id, created_at(sort: Desc)])
  @@index([tenant_id, created_at(sort: Desc)])
}

model JobEvent {
  id         BigInt    @id @default(autoincrement())
  job_id     String    @db.Uuid
  trace_id   String?   @db.Uuid
  event_type String    @db.VarChar(64)  // "parse", "optimize", "export", etc.
  payload    Json?     @db.JsonB
  created_at DateTime  @default(now()) @db.Timestamptz

  job        Job       @relation(fields: [job_id], references: [id], onDelete: Cascade)

  @@index([job_id, created_at(sort: Desc)])
  @@index([trace_id])
}

model Task {
  id              String    @id @default(uuid()) @db.Uuid
  job_id          String    @db.Uuid
  idempotency_key String    @unique @db.Uuid
  task_type       String    @db.VarChar(64)  // "export", "optimize_all"
  status          String    @db.VarChar(32)  // "pending", "running", "completed", "failed"

  // Input (snapshot at creation time)
  input_payload   Json      @db.JsonB

  // Output (populated on completion)
  output_payload  Json?     @db.JsonB
  error_message   String?   @db.Text

  // Lifecycle
  heartbeat_at    DateTime? @db.Timestamptz
  started_at      DateTime? @db.Timestamptz
  completed_at    DateTime? @db.Timestamptz
  created_at      DateTime  @default(now()) @db.Timestamptz

  job             Job       @relation(fields: [job_id], references: [id], onDelete: Cascade)

  @@index([status, created_at(sort: Asc)])  // Worker polling
  @@index([job_id, created_at(sort: Desc)])
  @@index([idempotency_key])
}

model ExportVersion {
  id            BigInt    @id @default(autoincrement())
  job_id        String    @db.Uuid
  version       Int       // Auto-increment per job

  pdf_blob_path String?   @db.VarChar(1024)
  docx_blob_path String?  @db.VarChar(1024)

  created_at    DateTime  @default(now()) @db.Timestamptz

  @@unique([job_id, version])
  @@index([job_id, version(sort: Desc)])
}
```

#### Repository Interfaces

**JobRepository.ts:**
```typescript
export class JobRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    owner_user_id: string;
    tenant_id?: string | null;
  }): Promise<Job>

  async findById(id: string): Promise<Job | null>

  async updateSections(id: string, sections: Section[]): Promise<void>

  async confirmSections(id: string): Promise<void>

  async markSchemaDirty(id: string, dirty: boolean): Promise<void>

  async uploadResume(id: string, filename: string, blob_path: string): Promise<void>

  async uploadSchema(id: string, filename: string, blob_path: string): Promise<void>

  async uploadJD(id: string, filename: string, blob_path: string, text: string): Promise<void>

  async listByUser(owner_user_id: string, limit: number): Promise<Job[]>
}
```

**TaskRepository.ts:**
```typescript
export class TaskRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    job_id: string;
    idempotency_key: string;
    task_type: string;
    input_payload: any;
  }): Promise<Task>

  async findByIdempotencyKey(key: string): Promise<Task | null>

  async findById(id: string): Promise<Task | null>

  async markRunning(id: string): Promise<void>

  async updateHeartbeat(id: string): Promise<void>

  async complete(id: string, output: any): Promise<void>

  async fail(id: string, error: string): Promise<void>

  async findPendingTasks(limit: number): Promise<Task[]>
}
```

#### Environment Variables

**.env.example:**
```bash
# PostgreSQL
DATABASE_URL="postgresql://user:password@localhost:5432/resume_agent"

# Azure Blob Storage (PR3)
AZURE_STORAGE_ACCOUNT_NAME=""
AZURE_STORAGE_ACCOUNT_KEY=""
AZURE_STORAGE_CONTAINER_NAME="resume-exports"

# Worker (for Python direct connection, PR2)
POSTGRES_HOST="localhost"
POSTGRES_PORT="5432"
POSTGRES_DB="resume_agent"
POSTGRES_USER="user"
POSTGRES_PASSWORD="password"
```

#### Migration Strategy

1. **Local dev:** `npx prisma migrate dev --name init`
2. **Production:** `npx prisma migrate deploy` (in CI/CD)
3. **Rollback:** Manual SQL (Prisma doesn't support auto-rollback)

#### Testing Checklist (PR1)

- [ ] `npx prisma generate` succeeds
- [ ] `npx prisma migrate dev` succeeds
- [ ] JobRepository.create() inserts row, returns UUID
- [ ] JobRepository.findById() returns null for missing ID
- [ ] TaskRepository.findByIdempotencyKey() enforces uniqueness
- [ ] Foreign key cascade deletes work (delete job → events/tasks deleted)
- [ ] TypeScript compilation: `npx tsc --noEmit`

#### Non-Goals (PR1)

- No worker DB connection yet (PR2)
- No Azure Blob integration yet (PR3)
- No API route changes (PR2)
- No UI changes

#### Risks (PR1)

- **Schema evolution:** Adding columns later requires migrations (mitigated: JSONB for flexibility)
- **Prisma version lock-in:** Upgrading Prisma may break generated client (mitigated: pin versions)

---

### PR2: trace_id Propagation + Structured Logging + job_events

**Goal:** Add observability, wire up repositories to existing API routes, NO functional changes.

**Scope:** Web API routes, worker logging setup.

#### Files Added

```
web/
  lib/
    observability/
      trace.ts              # generateTraceId(), extractTraceId()
      logger.ts             # Structured logger (dev mode only)
  app/api/_middleware/
    trace.ts                # Middleware to inject trace_id

worker-py/
  src/
    db.py                   # PostgreSQL connection pool
    repositories.py         # Python equivalents (JobRepo, TaskRepo)
    logger.py               # Structured JSON logger
  .env.example              # Add POSTGRES_* vars
```

#### Files Modified

```
web/
  app/api/parse/route.ts    # Add trace_id, log event
  app/api/optimize/route.ts # Add trace_id, log event
  app/api/export/route.ts   # Add trace_id, log event (NO behavior change)
  app/api/agent/route.ts    # Add trace_id
  lib/agent/agents/architect_proxy_agent.ts  # Forward trace_id to worker

worker-py/
  src/app.py                # Log trace_id, write job_events
  requirements.txt          # Add psycopg2-binary
```

#### trace_id Middleware (Web)

```typescript
// web/lib/observability/trace.ts
import { v4 as uuidv4 } from 'uuid';

export function generateTraceId(): string {
  return uuidv4();
}

export function extractTraceId(req: Request): string {
  const header = req.headers.get('X-Trace-ID');
  if (header && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(header)) {
    return header;
  }
  return generateTraceId();
}
```

**Pattern (apply to all API routes):**
```typescript
export async function POST(req: Request) {
  const trace_id = extractTraceId(req);
  console.log(`[trace_id=${trace_id}] /api/export started`);

  // ... existing logic ...

  // Log event to DB
  await jobRepo.logEvent(job_id, {
    event_type: 'export',
    trace_id,
    payload: { sections_count: sections.length }
  });

  // Forward trace_id to worker
  const response = await fetch(`${WORKER_BASE}/export`, {
    headers: {
      'X-Trace-ID': trace_id,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ job_id, ... })
  });
}
```

#### Worker DB Connection (Python)

```python
# worker-py/src/db.py
import os
import psycopg2
from psycopg2.pool import SimpleConnectionPool

pool = SimpleConnectionPool(
    minconn=1,
    maxconn=10,
    host=os.getenv("POSTGRES_HOST", "localhost"),
    port=int(os.getenv("POSTGRES_PORT", "5432")),
    database=os.getenv("POSTGRES_DB", "resume_agent"),
    user=os.getenv("POSTGRES_USER", "user"),
    password=os.getenv("POSTGRES_PASSWORD", "password")
)

def get_conn():
    return pool.getconn()

def release_conn(conn):
    pool.putconn(conn)
```

```python
# worker-py/src/repositories.py
import json
from datetime import datetime
from typing import Optional

def log_job_event(job_id: str, event_type: str, trace_id: Optional[str], payload: dict):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO job_events (job_id, trace_id, event_type, payload, created_at)
                VALUES (%s, %s, %s, %s, NOW())
                """,
                (job_id, trace_id, event_type, json.dumps(payload))
            )
            conn.commit()
    finally:
        release_conn(conn)

def update_job_timestamp(job_id: str):
    """Update job.updated_at to track last activity"""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE jobs SET updated_at = NOW() WHERE id = %s",
                (job_id,)
            )
            conn.commit()
    finally:
        release_conn(conn)
```

#### Structured Logging (Worker)

```python
# worker-py/src/logger.py
import logging
import json
import sys

def setup_logger():
    logger = logging.getLogger("resume-agent")
    logger.setLevel(logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)

    return logger

class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_obj = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "trace_id": getattr(record, "trace_id", None),
            "message": record.getMessage(),
            "module": record.module,
        }
        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_obj)

logger = setup_logger()
```

**Usage in worker:**
```python
@app.post("/export")
async def export_endpoint(req: ExportRequest, request: Request):
    trace_id = request.headers.get("X-Trace-ID")
    logger.info(
        "Export started",
        extra={"trace_id": trace_id, "job_id": req.job_id}
    )

    log_job_event(req.job_id, "export_started", trace_id, {"sections": len(req.sections)})

    # ... existing export logic ...

    log_job_event(req.job_id, "export_completed", trace_id, {"pdf": pdf_path, "docx": docx_path})
    update_job_timestamp(req.job_id)
```

#### Testing Checklist (PR2)

- [ ] Web generates trace_id, forwards to worker
- [ ] Worker logs include trace_id in JSON format
- [ ] job_events table populated on parse/optimize/export
- [ ] job.updated_at updates after worker operations
- [ ] Existing `/api/export` behavior unchanged (still synchronous)
- [ ] TypeScript compilation succeeds
- [ ] Worker starts with valid DATABASE_URL

#### Non-Goals (PR2)

- No async export yet (PR3)
- No Azure Blob integration yet (PR3)
- No UI changes
- No job persistence (state still ephemeral, DB is write-only audit log)

#### Risks (PR2)

- **Worker DB connection failure:** Worker should fail-closed (log error, return 500, do NOT break existing flow)
  - Mitigation: DB writes in try/except, continue on failure
- **Trace ID collision:** Extremely unlikely with UUID v4 (2^122 space)
- **Performance:** DB writes add ~10ms latency per request
  - Mitigation: Use connection pooling, async inserts (future)

---

### PR3: Async Export + Azure Blob Storage + SAS URLs

**Goal:** Add async export endpoints, migrate file storage to Blob, generate SAS URLs on-demand.

**Scope:** New API routes, worker blob integration, backward compatibility preserved.

#### Files Added

```
web/
  app/api/tasks/
    export/route.ts         # POST /api/tasks/export (async)
    [task_id]/route.ts      # GET /api/tasks/:task_id (poll)
  lib/
    blob/
      client.ts             # Azure Blob client singleton
      sas.ts                # generateSasUrl(blob_path, ttl_minutes)

worker-py/
  src/
    blob_client.py          # Azure Blob upload/download
    async_export.py         # Async export task handler
    task_poller.py          # Background task polling loop
```

#### Files Modified

```
web/
  app/api/download/route.ts  # Add SAS URL support (fallback to worker /files)
  package.json               # Add @azure/storage-blob

worker-py/
  src/app.py                 # Add /tasks/poll endpoint
  requirements.txt           # Add azure-storage-blob
```

#### Azure Blob Client (Web)

```typescript
// web/lib/blob/client.ts
import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from '@azure/storage-blob';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'resume-exports';

const credential = new StorageSharedKeyCredential(accountName, accountKey);
const blobServiceClient = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  credential
);

export function getBlobClient(blobPath: string) {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  return containerClient.getBlobClient(blobPath);
}

export function generateSasUrl(blobPath: string, ttlMinutes: number = 45): string {
  const blobClient = getBlobClient(blobPath);
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('r'), // read-only
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + ttlMinutes * 60 * 1000)
    },
    credential
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}
```

#### Async Export API (Web)

```typescript
// web/app/api/tasks/export/route.ts
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { TaskRepository } from '@/lib/db/repositories/TaskRepository';
import { extractTraceId } from '@/lib/observability/trace';

export async function POST(req: Request) {
  const trace_id = extractTraceId(req);
  const body = await req.json();

  const {
    job_id,
    idempotency_key = uuidv4(), // Client can provide, or we generate
    sections,
    base_name,
    export_pdf = true
  } = body;

  // Validation
  if (!job_id || !sections || sections.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Missing job_id or sections' },
      { status: 400 }
    );
  }

  const taskRepo = new TaskRepository(prisma);

  // Idempotency check
  const existing = await taskRepo.findByIdempotencyKey(idempotency_key);
  if (existing) {
    console.log(`[trace_id=${trace_id}] Idempotency hit: ${existing.id}`);
    return NextResponse.json({
      ok: true,
      task_id: existing.id,
      status: existing.status
    }, { status: 200 });
  }

  // Create new task
  const task = await taskRepo.create({
    job_id,
    idempotency_key,
    task_type: 'export',
    input_payload: { sections, base_name, export_pdf, trace_id }
  });

  console.log(`[trace_id=${trace_id}] Created task ${task.id}`);

  return NextResponse.json({
    ok: true,
    task_id: task.id,
    status: 'pending'
  }, { status: 202 });
}
```

```typescript
// web/app/api/tasks/[task_id]/route.ts
import { NextResponse } from 'next/server';
import { TaskRepository } from '@/lib/db/repositories/TaskRepository';
import { generateSasUrl } from '@/lib/blob/sas';

export async function GET(req: Request, { params }: { params: { task_id: string } }) {
  const { task_id } = params;

  const taskRepo = new TaskRepository(prisma);
  const task = await taskRepo.findById(task_id);

  if (!task) {
    return NextResponse.json(
      { ok: false, error: 'Task not found' },
      { status: 404 }
    );
  }

  // Check heartbeat staleness
  const now = Date.now();
  const heartbeat = task.heartbeat_at?.getTime() || 0;
  const stale = task.status === 'running' && (now - heartbeat > 60_000);

  if (stale) {
    return NextResponse.json({
      ok: false,
      error: 'Worker unresponsive (heartbeat stale)',
      task_id: task.id,
      status: 'failed'
    }, { status: 500 });
  }

  if (task.status === 'completed') {
    const output = task.output_payload as any;
    const artifacts = output.artifacts || [];

    // Generate SAS URLs on-demand (NEVER persisted)
    const artifactsWithSas = artifacts.map((a: any) => ({
      kind: a.kind,
      filename: a.filename,
      url: generateSasUrl(a.blob_path, 45) // 45min TTL
    }));

    return NextResponse.json({
      ok: true,
      task_id: task.id,
      status: 'completed',
      artifacts: artifactsWithSas
    });
  }

  if (task.status === 'failed') {
    return NextResponse.json({
      ok: false,
      task_id: task.id,
      status: 'failed',
      error: task.error_message
    }, { status: 500 });
  }

  // pending or running
  return NextResponse.json({
    ok: true,
    task_id: task.id,
    status: task.status
  });
}
```

#### Worker Blob Integration (Python)

```python
# worker-py/src/blob_client.py
import os
from azure.storage.blob import BlobServiceClient

account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")
account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY")
container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "resume-exports")

blob_service_client = BlobServiceClient(
    account_url=f"https://{account_name}.blob.core.windows.net",
    credential=account_key
)

def upload_blob(blob_path: str, file_path: str):
    """Upload file to Azure Blob Storage"""
    blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)
    with open(file_path, "rb") as data:
        blob_client.upload_blob(data, overwrite=True)
    return blob_path

def download_blob(blob_path: str, dest_path: str):
    """Download blob to local file (for rendering)"""
    blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)
    with open(dest_path, "wb") as f:
        f.write(blob_client.download_blob().readall())
```

```python
# worker-py/src/async_export.py
import time
from datetime import datetime
from .blob_client import upload_blob
from .repositories import update_task_status, update_task_heartbeat, complete_task, fail_task
from .utils_sections import generate_pdf, generate_docx

def execute_export_task(task_id: str, job_id: str, input_payload: dict):
    """Execute async export task"""
    try:
        update_task_status(task_id, "running")
        update_task_heartbeat(task_id)

        sections = input_payload["sections"]
        base_name = input_payload.get("base_name", "Resume")

        # Generate files locally (existing logic)
        timestamp = int(time.time())
        pdf_local = f"/tmp/{job_id}_Resume.pdf"
        docx_local = f"/tmp/{job_id}_Resume.docx"

        generate_pdf(sections, pdf_local)
        update_task_heartbeat(task_id)

        generate_docx(sections, docx_local)
        update_task_heartbeat(task_id)

        # Upload to Blob
        pdf_blob = f"{job_id}/exports/{timestamp}_Resume.pdf"
        docx_blob = f"{job_id}/exports/{timestamp}_Resume.docx"

        upload_blob(pdf_blob, pdf_local)
        update_task_heartbeat(task_id)

        upload_blob(docx_blob, docx_local)

        # Complete task with blob paths (NOT SAS URLs)
        output = {
            "artifacts": [
                {"kind": "pdf", "filename": f"{base_name}.pdf", "blob_path": pdf_blob},
                {"kind": "docx", "filename": f"{base_name}.docx", "blob_path": docx_blob}
            ]
        }
        complete_task(task_id, output)

    except Exception as e:
        fail_task(task_id, str(e))
```

```python
# worker-py/src/task_poller.py
import time
from .repositories import fetch_pending_tasks
from .async_export import execute_export_task

def poll_tasks():
    """Background loop: poll DB for pending tasks"""
    while True:
        tasks = fetch_pending_tasks(limit=1)
        if not tasks:
            time.sleep(2)
            continue

        task = tasks[0]
        if task["task_type"] == "export":
            execute_export_task(
                task["id"],
                task["job_id"],
                task["input_payload"]
            )

        time.sleep(1)

# In worker startup (app.py):
# import threading
# threading.Thread(target=poll_tasks, daemon=True).start()
```

#### Modified Download Route (Backward Compatible)

```typescript
// web/app/api/download/route.ts (updated)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const job_id = searchParams.get('job_id');
  const file = searchParams.get('file');
  const blob_path = searchParams.get('blob_path'); // NEW

  // NEW: If blob_path provided, generate SAS URL and redirect
  if (blob_path) {
    const sasUrl = generateSasUrl(blob_path, 45);
    return NextResponse.redirect(sasUrl);
  }

  // LEGACY: Fallback to worker /files (Phase 4 behavior)
  if (!job_id || !file) {
    return NextResponse.json(
      { ok: false, error: 'Missing job_id or file or blob_path' },
      { status: 400 }
    );
  }

  // ... existing validation + proxy to worker ...
}
```

#### Client-Side Usage (Frontend)

**Async Export Flow:**
```typescript
// Call new async export endpoint
const resp = await fetch('/api/tasks/export', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    job_id: jobId,
    idempotency_key: uuidv4(), // Generate once per export attempt
    sections: sections,
    base_name: 'Resume',
    export_pdf: true
  })
});

const { task_id, status } = await resp.json();

// Poll for completion
const poll = setInterval(async () => {
  const taskResp = await fetch(`/api/tasks/${task_id}`);
  const taskData = await taskResp.json();

  if (taskData.status === 'completed') {
    clearInterval(poll);
    setExportLinks({ artifacts: taskData.artifacts });
  } else if (taskData.status === 'failed') {
    clearInterval(poll);
    setNotice(taskData.error);
  }
}, 2000); // Poll every 2 seconds
```

#### Version Retention (Blob Lifecycle Policy)

**Azure Portal Configuration:**
- Container: `resume-exports`
- Lifecycle rule: Delete blobs older than 90 days
- Soft-delete: 30 days (recovery window)

**Per-Job Retention (enforced by worker):**
```python
def cleanup_old_versions(job_id: str):
    """Keep only N=5 most recent export versions"""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM export_versions
                WHERE job_id = %s
                AND version NOT IN (
                  SELECT version FROM export_versions
                  WHERE job_id = %s
                  ORDER BY version DESC
                  LIMIT 5
                )
                """,
                (job_id, job_id)
            )
            conn.commit()
    finally:
        release_conn(conn)
```

#### Testing Checklist (PR3)

- [ ] POST `/api/tasks/export` returns task_id (202)
- [ ] GET `/api/tasks/:task_id` returns pending → running → completed
- [ ] Idempotency: duplicate POST returns same task_id
- [ ] Worker uploads files to Blob Storage
- [ ] SAS URLs generated with 45min TTL
- [ ] SAS URLs expire after 45 minutes
- [ ] Download redirects work (both legacy /files and new blob_path)
- [ ] Heartbeat staleness detection (>60s → failed)
- [ ] Old export versions cleaned up (N=5 retained)
- [ ] Existing `/api/export` unchanged (synchronous flow works)

#### Non-Goals (PR3)

- No UI redesign (reuse existing export button with async flow)
- No WebSocket/SSE progress streaming (use polling)
- No multi-worker horizontal scaling (single worker polls)
- No CDN integration (direct Blob SAS URLs)

#### Risks (PR3)

- **Azure Blob outage:** Export fails, task marked failed
  - Mitigation: Retry logic in worker (3 attempts with backoff)
- **SAS URL expiry:** User waits >45min before download
  - Mitigation: Client re-fetches task to regenerate SAS URL
- **Blob upload failure:** Partial uploads corrupt state
  - Mitigation: Transactional uploads (overwrite=True ensures atomic)
- **Worker polling inefficiency:** DB polling adds latency
  - Mitigation: 1-2s poll interval, LIMIT 1 (low overhead)
  - Future: Replace with queue (RabbitMQ, Azure Queue Storage)

---

## API Contracts (New Endpoints)

### POST `/api/tasks/export`

**Request:**
```json
{
  "job_id": "uuid",
  "idempotency_key": "uuid",  // Optional, generated if missing
  "sections": [
    { "id": "1", "title": "Summary", "text": "...", "optimized_text": "..." }
  ],
  "base_name": "Resume",
  "export_pdf": true
}
```

**Response (202 Accepted):**
```json
{
  "ok": true,
  "task_id": "uuid",
  "status": "pending"
}
```

**Response (200 OK - Idempotency Hit):**
```json
{
  "ok": true,
  "task_id": "uuid",
  "status": "completed"  // or "pending", "running", "failed"
}
```

### GET `/api/tasks/:task_id`

**Response (pending/running):**
```json
{
  "ok": true,
  "task_id": "uuid",
  "status": "running"
}
```

**Response (completed):**
```json
{
  "ok": true,
  "task_id": "uuid",
  "status": "completed",
  "artifacts": [
    {
      "kind": "pdf",
      "filename": "Resume.pdf",
      "url": "https://account.blob.core.windows.net/container/path?sas_token"
    },
    {
      "kind": "docx",
      "filename": "Resume.docx",
      "url": "https://account.blob.core.windows.net/container/path?sas_token"
    }
  ]
}
```

**Response (failed):**
```json
{
  "ok": false,
  "task_id": "uuid",
  "status": "failed",
  "error": "Worker unresponsive (heartbeat stale)"
}
```

---

## UI Changes (Minimal)

### AutoMode Export Action

**Current Flow (Synchronous):**
1. User clicks "Generate CV"
2. Frontend calls `/api/export` (blocks 10-30s)
3. Response includes download links
4. UI shows "Download PDF" / "Download DOCX" buttons

**New Flow (Async - Optional):**
1. User clicks "Generate CV (Async)"
2. Frontend calls `/api/tasks/export` → task_id
3. UI shows "Exporting... (polling)"
4. Poll `/api/tasks/:task_id` every 2s
5. On completion, show download buttons

**Backward Compatibility:**
- Keep existing "Generate CV" button (calls `/api/export`)
- Add new "Generate CV (Background)" button (calls `/api/tasks/export`)
- User can choose flow (sync for speed, async for reliability)

**No Changes Required:**
- Existing export action (`actions/export.ts`) unchanged
- Async export is NEW action (`actions/export_async.ts`)

---

## Migration Path

### Phase 1: PR1 Merged

**State:**
- Database schema exists
- Repositories available
- NO data persistence yet (state still ephemeral)
- NO behavioral changes

**Rollout:**
- Deploy PR1 to staging
- Run migrations
- Verify schema created
- No user-facing changes

### Phase 2: PR2 Merged

**State:**
- trace_id logged in all API routes
- job_events populated (audit log)
- Worker logs structured JSON
- NO functional changes (still synchronous, ephemeral state)

**Rollout:**
- Deploy PR2 to staging
- Verify trace_id in logs
- Query `job_events` table for activity
- No user-facing changes

### Phase 3: PR3 Merged

**State:**
- Async export available (`/api/tasks/export`)
- Files stored in Azure Blob
- SAS URLs generated on-demand
- Existing `/api/export` UNCHANGED (synchronous, legacy)

**Rollout:**
- Deploy PR3 to staging
- Test async export flow end-to-end
- Verify Blob uploads
- Verify SAS URLs work
- Enable for beta users only (feature flag)
- Gradual rollout: 10% → 50% → 100%

### Rollback Plan

**If PR3 breaks production:**
1. Revert deployment to PR2 tag
2. Existing `/api/export` continues working (no Blob dependency)
3. Investigate issue, fix, redeploy

**Data Loss Risk:**
- PR1/PR2: Zero (no data persisted)
- PR3: Low (Blob uploads are write-only, no reads from legacy flow)

---

## Constraints & Invariants

### DO NOT BREAK

1. **Existing `/api/export` MUST remain synchronous and unchanged**
   - No Blob dependency in legacy flow
   - Returns `pdf_url`/`docx_url` from worker `/files`
   - Backward compatible with Phase 4 behavior

2. **Worker MUST NOT callback to web**
   - All state writes go directly to PostgreSQL
   - No fetch() calls to Next.js API routes

3. **SAS URLs NEVER persisted**
   - Database stores `blob_path` only
   - SAS URLs generated on-demand (45min TTL)
   - Prevents credential leakage

4. **Idempotency enforced**
   - `tasks.idempotency_key` UNIQUE constraint
   - Duplicate POST returns existing task

5. **B2C model enforced**
   - `jobs.owner_user_id` NOT NULL
   - `jobs.tenant_id` NULLABLE
   - No multi-tenancy enforcement (out of scope)

---

## Open Questions

1. **Auth Layer:** Who populates `owner_user_id`?
   - **Answer (for now):** Hardcode placeholder user ID (`"dev-user-1"`)
   - **Future:** Replace with real auth (NextAuth, Clerk, etc.)

2. **Worker Scaling:** Single worker or multi-worker?
   - **Answer:** Single worker for Phase 5
   - **Future:** Add worker pool + job queue (Phase 6)

3. **Database Hosting:** Where to host PostgreSQL?
   - **Answer:** Developer choice (local, Azure Database, RDS, Supabase)
   - **Requirement:** Must support JSONB, UUID

4. **Blob CDN:** Should SAS URLs route through CDN?
   - **Answer:** Not in Phase 5 (direct Blob URLs)
   - **Future:** Add Azure Front Door or CloudFront

5. **Task Cleanup:** When to delete completed tasks?
   - **Answer:** 7-day TTL (cron job or Blob lifecycle)
   - **Implementation:** Deferred to Phase 6

---

## Success Metrics

**PR1:**
- [ ] Schema deployed to staging
- [ ] Repositories pass integration tests
- [ ] TypeScript compilation clean

**PR2:**
- [ ] 100% of API requests have trace_id
- [ ] job_events table shows activity
- [ ] Worker logs searchable by trace_id
- [ ] Zero functional regressions

**PR3:**
- [ ] Async export completes in <30s (p95)
- [ ] SAS URLs valid for 45min
- [ ] Idempotency prevents duplicate exports
- [ ] Legacy `/api/export` unaffected
- [ ] Zero Blob upload failures (p99)

---

## Handoff Checklist

**Before starting PR1:**
- [ ] User approves this plan
- [ ] Confirm PostgreSQL hosting choice
- [ ] Confirm Azure Blob account exists
- [ ] Review schema design for feedback

**Before merging each PR:**
- [ ] TypeScript compilation: `npx tsc --noEmit`
- [ ] Prisma migration: `npx prisma migrate dev`
- [ ] Integration tests pass
- [ ] Manual smoke test in staging
- [ ] Rollback plan documented

**After Phase 5 complete:**
- [ ] Update `ARCHITECTURE_phase4.md` → `ARCHITECTURE_phase5.md`
- [ ] Document new endpoints in API reference
- [ ] Update README with setup instructions (Prisma, Blob, env vars)

---

## Next Steps (Post-Approval)

1. **User reviews this plan** and provides feedback
2. **Refinement:** Address open questions, adjust schema if needed
3. **PR1:** Implement PostgreSQL + Prisma (no behavior change)
4. **PR2:** Add trace_id + logging (no behavior change)
5. **PR3:** Async export + Blob storage (new endpoints)
6. **Phase 6 Planning:** Job queue, multi-worker, CDN, auth layer

---

**END OF PLAN**

*Awaiting user approval to proceed with implementation.*
