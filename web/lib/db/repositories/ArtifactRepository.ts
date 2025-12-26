// web/lib/db/repositories/ArtifactRepository.ts
// Phase 5 PR1: Artifact repository for export version management

import { PrismaClient, Artifact } from "@prisma/client";

export type ArtifactWithLatest = Artifact & {
  is_latest?: boolean;
};

export class ArtifactRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Allocate next version number for (job_id, kind) - concurrency safe
   * Uses artifact_counters table with atomic increment
   */
  async allocateVersion(job_id: string, kind: string): Promise<number> {
    // Upsert counter and get next version atomically
    const result = await this.prisma.$executeRaw`
      INSERT INTO "ArtifactCounter" (job_id, kind, next_version)
      VALUES (${job_id}::uuid, ${kind}, 1)
      ON CONFLICT (job_id, kind)
      DO UPDATE SET next_version = "ArtifactCounter".next_version + 1
      RETURNING next_version
    `;

    // Note: In production, use Prisma raw query to get RETURNING value
    // For now, query back the counter
    const counter = await this.prisma.artifactCounter.findUnique({
      where: {
        job_id_kind: {
          job_id,
          kind,
        },
      },
    });

    return counter?.next_version || 1;
  }

  /**
   * Create artifact with pre-allocated version
   */
  async create(data: {
    job_id: string;
    owner_user_id: string;
    task_id: string | null;
    kind: string;
    version: number;
    is_zip: boolean;
    blob_path: string;
    filename: string;
    file_size_bytes?: number;
    content_type?: string;
    expires_days?: number;
  }): Promise<Artifact> {
    const expires_at = new Date(
      Date.now() + (data.expires_days || 90) * 24 * 60 * 60 * 1000
    );

    return await this.prisma.artifact.create({
      data: {
        job_id: data.job_id,
        owner_user_id: data.owner_user_id,
        task_id: data.task_id,
        kind: data.kind,
        version: data.version,
        is_zip: data.is_zip,
        blob_path: data.blob_path,
        filename: data.filename,
        file_size_bytes: data.file_size_bytes,
        content_type: data.content_type,
        expires_at,
      },
    });
  }

  /**
   * Update latest pointer for (job_id, kind)
   * Uses job_artifact_latest table with upsert
   */
  async updateLatestPointer(
    job_id: string,
    kind: string,
    artifact_id: bigint,
    version: number
  ): Promise<void> {
    await this.prisma.jobArtifactLatest.upsert({
      where: {
        job_id_kind: {
          job_id,
          kind,
        },
      },
      create: {
        job_id,
        kind,
        latest_artifact_id: artifact_id,
        latest_version: version,
      },
      update: {
        latest_artifact_id: artifact_id,
        latest_version: version,
      },
    });
  }

  /**
   * Get latest artifact for (job_id, kind) with owner isolation
   */
  async getLatest(
    job_id: string,
    kind: string,
    owner_user_id: string
  ): Promise<ArtifactWithLatest | null> {
    const latest = await this.prisma.jobArtifactLatest.findUnique({
      where: {
        job_id_kind: {
          job_id,
          kind,
        },
      },
    });

    if (!latest) return null;

    const artifact = await this.prisma.artifact.findFirst({
      where: {
        id: latest.latest_artifact_id,
        owner_user_id,
      },
    });

    if (!artifact) return null;

    return {
      ...artifact,
      is_latest: true,
    };
  }

  /**
   * Get all latest artifacts for a job (with owner isolation)
   * Used by API to return download URLs
   */
  async getAllLatest(
    job_id: string,
    owner_user_id: string
  ): Promise<ArtifactWithLatest[]> {
    const latestPointers = await this.prisma.jobArtifactLatest.findMany({
      where: {
        job_id,
      },
    });

    const artifacts: ArtifactWithLatest[] = [];

    for (const pointer of latestPointers) {
      const artifact = await this.prisma.artifact.findFirst({
        where: {
          id: pointer.latest_artifact_id,
          owner_user_id,
        },
      });

      if (artifact) {
        artifacts.push({
          ...artifact,
          is_latest: true,
        });
      }
    }

    return artifacts;
  }

  /**
   * Get version history for (job_id, kind) - last N versions
   * Retention enforced at read time (not via deletion)
   */
  async getHistory(
    job_id: string,
    kind: string,
    owner_user_id: string,
    limit: number = 5
  ): Promise<Artifact[]> {
    return await this.prisma.artifact.findMany({
      where: {
        job_id,
        kind,
        owner_user_id,
      },
      orderBy: {
        version: "desc",
      },
      take: limit,
    });
  }

  /**
   * Find artifact by ID (with owner isolation)
   */
  async findById(
    id: bigint,
    owner_user_id: string
  ): Promise<Artifact | null> {
    return await this.prisma.artifact.findFirst({
      where: {
        id,
        owner_user_id,
      },
    });
  }

  /**
   * Delete expired artifacts (Phase 6 cron job)
   * Not used in Phase 5 (retention at read time)
   */
  async deleteExpired(): Promise<number> {
    const now = new Date();

    // Only delete non-latest artifacts
    const expired = await this.prisma.artifact.findMany({
      where: {
        expires_at: {
          lt: now,
        },
      },
      select: {
        id: true,
        job_id: true,
        kind: true,
      },
    });

    const latestPointers = await this.prisma.jobArtifactLatest.findMany({
      select: {
        latest_artifact_id: true,
      },
    });

    const latestIds = new Set(latestPointers.map((p) => p.latest_artifact_id));

    const toDelete = expired.filter((a) => !latestIds.has(a.id));

    if (toDelete.length === 0) return 0;

    const result = await this.prisma.artifact.deleteMany({
      where: {
        id: {
          in: toDelete.map((a) => a.id),
        },
      },
    });

    return result.count;
  }
}
