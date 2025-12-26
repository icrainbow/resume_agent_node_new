-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "owner_user_id" VARCHAR(255) NOT NULL,
    "tenant_id" VARCHAR(255),
    "resume_filename" VARCHAR(512),
    "resume_blob_path" VARCHAR(1024),
    "schema_filename" VARCHAR(512),
    "schema_blob_path" VARCHAR(1024),
    "jd_filename" VARCHAR(512),
    "jd_blob_path" VARCHAR(1024),
    "jd_text" TEXT,
    "current_schema" JSONB,
    "sections" JSONB,
    "cv_sections_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "schema_dirty" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "owner_user_id" VARCHAR(255) NOT NULL,
    "trace_id" UUID,
    "event_type" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "owner_user_id" VARCHAR(255) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "task_type" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
    "stage" VARCHAR(64),
    "input_payload" JSONB NOT NULL,
    "output_payload" JSONB,
    "error_message" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "timeout_at" TIMESTAMPTZ,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "owner_user_id" VARCHAR(255) NOT NULL,
    "task_id" UUID,
    "kind" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL,
    "is_zip" BOOLEAN NOT NULL DEFAULT false,
    "blob_path" VARCHAR(1024) NOT NULL,
    "filename" VARCHAR(512) NOT NULL,
    "file_size_bytes" BIGINT,
    "content_type" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactCounter" (
    "job_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "next_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ArtifactCounter_pkey" PRIMARY KEY ("job_id","kind")
);

-- CreateTable
CREATE TABLE "JobArtifactLatest" (
    "job_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "latest_artifact_id" BIGINT NOT NULL,
    "latest_version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "JobArtifactLatest_pkey" PRIMARY KEY ("job_id","kind")
);

-- CreateIndex
CREATE INDEX "Job_owner_user_id_created_at_idx" ON "Job"("owner_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Job_tenant_id_created_at_idx" ON "Job"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "JobEvent_job_id_created_at_idx" ON "JobEvent"("job_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "JobEvent_trace_id_idx" ON "JobEvent"("trace_id");

-- CreateIndex
CREATE INDEX "JobEvent_owner_user_id_event_type_created_at_idx" ON "JobEvent"("owner_user_id", "event_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Task_job_id_created_at_idx" ON "Task"("job_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Task_owner_user_id_status_created_at_idx" ON "Task"("owner_user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Task_timeout_at_idx" ON "Task"("timeout_at");

-- CreateIndex
CREATE UNIQUE INDEX "Task_owner_user_id_idempotency_key_key" ON "Task"("owner_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "Artifact_owner_user_id_kind_created_at_idx" ON "Artifact"("owner_user_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Artifact_expires_at_idx" ON "Artifact"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_job_id_kind_version_key" ON "Artifact"("job_id", "kind", "version");

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactCounter" ADD CONSTRAINT "ArtifactCounter_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobArtifactLatest" ADD CONSTRAINT "JobArtifactLatest_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
