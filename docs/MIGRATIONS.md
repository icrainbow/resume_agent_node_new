# Database Migration Strategy

**Phase 5 PR1**
**Date:** 2025-12-25

This document describes the database migration execution strategy for local development, staging, and production (AKS) environments.

---

## Overview

Migrations are managed by Prisma Migrate:
- **Development:** `prisma migrate dev` (creates + applies migrations)
- **Production:** `prisma migrate deploy` (applies existing migrations only)
- **Rollback:** Manual SQL scripts (Prisma does not generate down-migrations)

---

## Local Development

### Initial Setup

1. Install dependencies:
   ```bash
   cd web
   npm install
   ```

2. Start PostgreSQL (Docker or local):
   ```bash
   docker run --name postgres \
     -e POSTGRES_PASSWORD=password \
     -e POSTGRES_DB=resume_agent \
     -p 5432:5432 \
     -d postgres:16
   ```

3. Create `.env` file:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your database connection:
   ```
   DATABASE_URL="postgresql://postgres:password@localhost:5432/resume_agent?schema=public"
   ```

5. Generate Prisma Client:
   ```bash
   npx prisma generate
   ```

6. Run initial migration:
   ```bash
   npx prisma migrate dev --name init
   ```

   This will:
   - Create `prisma/migrations/YYYYMMDDHHMMSS_init/migration.sql`
   - Apply migration to database
   - Create 6 tables: Job, JobEvent, Task, Artifact, ArtifactCounter, JobArtifactLatest

7. Verify schema:
   ```bash
   npx prisma studio
   ```
   Opens browser UI at http://localhost:5555

### Creating New Migrations

When modifying `schema.prisma`:

```bash
npx prisma migrate dev --name add_new_field
```

Prisma will:
1. Detect schema changes
2. Generate migration SQL
3. Apply migration to your database
4. Regenerate Prisma Client

### Resetting Database (Dev Only)

**WARNING: Deletes all data**

```bash
npx prisma migrate reset
```

This will:
1. Drop database
2. Recreate database
3. Apply all migrations
4. Run seed script (if configured)

---

## Staging / Production (AKS)

### Strategy: Kubernetes Job (Pre-Deployment Hook)

Migrations run via Kubernetes Job triggered by Helm pre-upgrade/pre-install hook.

**Why this approach?**
- Decoupled from application pods (no race conditions)
- Runs exactly once per deployment
- Blocks rollout until migrations succeed
- Easy rollback (delete job, redeploy previous version)
- Concurrency-safe (Prisma uses advisory locks)

### Helm Chart Configuration

**Migration Job Template:**

```yaml
# templates/migration-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: prisma-migrate-{{ .Release.Revision }}
  namespace: {{ .Values.namespace }}
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: migrate
        image: {{ .Values.web.image.repository }}:{{ .Values.web.image.tag }}
        command:
          - "npx"
          - "prisma"
          - "migrate"
          - "deploy"
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: resume-agent-secrets
              key: DATABASE_URL
        - name: NODE_ENV
          value: "production"
      imagePullSecrets:
      - name: {{ .Values.imagePullSecret }}
  backoffLimit: 3
```

### Deployment Flow

1. Developer merges PR to `main` branch
2. CI/CD builds Docker images (web, worker)
3. CI/CD runs Helm upgrade:
   ```bash
   helm upgrade resume-agent ./charts/resume-agent \
     --install \
     --namespace default \
     --set web.image.tag=$CI_COMMIT_SHA
   ```
4. Helm triggers pre-upgrade hook (migration job)
5. Migration job runs `npx prisma migrate deploy`
6. If migrations succeed, job completes (exit 0)
7. Helm proceeds with deployment rollout
8. If migrations fail, job fails (exit 1), deployment aborted

### Manual Migration (Emergency)

If automatic migration fails, run manually:

```bash
# Get database credentials from secret
kubectl get secret resume-agent-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d

# Run migration in temporary pod
kubectl run -it --rm prisma-migrate \
  --image=your-registry/resume-agent-web:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql://..." \
  -- npx prisma migrate deploy
```

### Concurrency Protection

Prisma Migrate uses PostgreSQL advisory locks to prevent concurrent migrations:

- Lock acquired: `pg_advisory_lock(hash("prisma_migrate"))`
- If another migration running, waits or times out
- Lock released on completion

**Safe scenarios:**
- Multiple migration jobs triggered (only first runs, others wait)
- Developer runs manual migration during deployment (jobs wait)

---

## Rollback Procedures

### Schema Rollback (Manual)

Prisma does NOT generate down-migrations automatically. You must write manual rollback scripts.

**Example: Rollback "add_new_field" migration**

1. Identify migration to rollback:
   ```bash
   ls prisma/migrations/
   # Find: 20251225120000_add_new_field/
   ```

2. Write down-migration SQL:
   ```sql
   -- down-migrations/20251225120000_add_new_field.sql
   ALTER TABLE "Job" DROP COLUMN IF EXISTS new_field;
   ```

3. Apply rollback:
   ```bash
   psql $DATABASE_URL -f down-migrations/20251225120000_add_new_field.sql
   ```

4. Mark migration as rolled back in `_prisma_migrations` table:
   ```sql
   DELETE FROM "_prisma_migrations"
   WHERE migration_name = '20251225120000_add_new_field';
   ```

5. Redeploy previous application version

### Application Rollback (No Schema Changes)

If migration succeeded but application has bugs:

```bash
# Rollback application deployment
kubectl rollout undo deployment/web -n default
kubectl rollout undo deployment/worker -n default
```

Schema remains at new version (safe if backward compatible).

---

## Migration Testing

### Before Production Deployment

1. **Test on staging database:**
   ```bash
   # Point to staging database
   DATABASE_URL="postgresql://staging-host/..." npx prisma migrate deploy
   ```

2. **Verify migration SQL:**
   ```bash
   # Review generated SQL before applying
   cat prisma/migrations/*/migration.sql
   ```

3. **Test rollback procedure:**
   - Apply migration to test database
   - Write and test down-migration script
   - Verify application works after rollback

4. **Load testing:**
   - Apply migration to copy of production database
   - Run load tests to verify performance impact
   - Large tables: consider online schema change tools (gh-ost, pt-online-schema-change)

### Continuous Integration Checks

Add to CI/CD pipeline:

```yaml
# .github/workflows/test.yml
- name: Check migrations
  run: |
    cd web
    npx prisma migrate diff \
      --from-schema-datamodel prisma/schema.prisma \
      --to-schema-datasource $DATABASE_URL \
      --exit-code
```

This fails CI if schema.prisma doesn't match actual database.

---

## Migration Best Practices

### 1. Never Modify Existing Migrations

Once a migration is applied to production, **never modify it**.

**Bad:**
```bash
# Edit prisma/migrations/20251225_init/migration.sql
# Causes checksum mismatch, Prisma rejects
```

**Good:**
```bash
# Create new migration
npx prisma migrate dev --name fix_previous_migration
```

### 2. Backward Compatible Changes

Design migrations to be backward compatible with old application version:

**Safe:**
- Add nullable column: `ALTER TABLE Job ADD COLUMN new_field TEXT NULL;`
- Add new table: `CREATE TABLE NewTable (...);`
- Add index: `CREATE INDEX idx_job_owner ON Job(owner_user_id);`

**Unsafe (requires downtime):**
- Drop column: Old app queries will fail
- Rename column: Old app queries will fail
- Add NOT NULL column without default: Old app inserts will fail

**Solution for unsafe changes:**
1. Deploy migration that adds column (nullable)
2. Deploy application that uses new column
3. Backfill data
4. Deploy migration that adds NOT NULL constraint

### 3. Large Table Migrations

For tables with millions of rows, use online schema change tools:

**Example: Add index to large table**

Instead of:
```sql
CREATE INDEX idx_artifacts_job ON Artifact(job_id);
-- Locks table for hours
```

Use gh-ost (GitHub's online schema tool):
```bash
gh-ost \
  --host=postgres-host \
  --database=resume_agent \
  --table=Artifact \
  --alter="ADD INDEX idx_artifacts_job (job_id)" \
  --execute
```

### 4. Test Migrations in Transaction

For reversible migrations, wrap in transaction:

```sql
BEGIN;

-- Your migration SQL here
ALTER TABLE Job ADD COLUMN test_field TEXT;

-- Test queries
SELECT * FROM Job LIMIT 1;

-- If looks good, COMMIT. Otherwise, ROLLBACK.
COMMIT;
```

---

## Monitoring Migrations

### Check Migration Status

**In Kubernetes:**
```bash
# View migration job logs
kubectl logs job/prisma-migrate-<revision> -n default

# Check job status
kubectl get jobs -n default | grep prisma-migrate

# Describe failed job
kubectl describe job/prisma-migrate-<revision> -n default
```

**In Database:**
```sql
-- View applied migrations
SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC;

-- Check for failed migrations
SELECT * FROM "_prisma_migrations" WHERE finished_at IS NULL;
```

### Migration Alerts

Set up alerts for:
- Migration job failures (exit code > 0)
- Migration duration >5 minutes (unusually slow)
- Failed migration rollback (manual intervention needed)

---

## Emergency Procedures

### Migration Stuck / Hanging

**Symptom:** Migration job running for >30 minutes

**Diagnosis:**
```sql
-- Check locks
SELECT * FROM pg_locks WHERE granted = false;

-- Check long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 minutes';
```

**Solution:**
```bash
# Kill migration job
kubectl delete job/prisma-migrate-<revision>

# Kill database queries (last resort)
psql> SELECT pg_terminate_backend(<pid>);

# Retry migration manually
kubectl run -it --rm prisma-migrate ...
```

### Corrupted Migration State

**Symptom:** Prisma says "Migration already applied" but database doesn't have table

**Solution:**
```sql
-- Fix _prisma_migrations table
DELETE FROM "_prisma_migrations" WHERE migration_name = '<broken_migration>';

-- Rerun migration
```

### Rollback Required Immediately

**Symptom:** Migration caused production outage

**Immediate action:**
1. Rollback application deployment (kubectl rollout undo)
2. Assess schema damage (does old app work with new schema?)
3. If schema incompatible, run manual down-migration
4. Notify team, postmortem

---

## Phase 6 Considerations

Future improvements for migration strategy:

- **Blue/Green Deployments:** Run two versions simultaneously during migration
- **Schema Versioning:** Support multiple schema versions concurrently
- **Automated Rollback Scripts:** Generate down-migrations automatically
- **Migration Observability:** Structured logs, metrics, distributed tracing
- **Canary Migrations:** Apply migration to 10% of database first (sharding required)

---

## Resources

- [Prisma Migrate Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [PostgreSQL Online Schema Change Tools](https://github.com/github/gh-ost)
- [Kubernetes Jobs Documentation](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Helm Hooks Documentation](https://helm.sh/docs/topics/charts_hooks/)
