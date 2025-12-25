// web/lib/db/repositories/JobRepository.ts
// Phase 5 PR1: Job repository for database operations

import { PrismaClient, Job } from "@prisma/client";
import type { Section } from "@/app/automode/_types/types";

export class JobRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new job
   */
  async create(data: {
    owner_user_id: string;
    tenant_id?: string | null;
  }): Promise<Job> {
    return await this.prisma.job.create({
      data: {
        owner_user_id: data.owner_user_id,
        tenant_id: data.tenant_id || null,
      },
    });
  }

  /**
   * Find job by ID
   */
  async findById(id: string): Promise<Job | null> {
    return await this.prisma.job.findUnique({
      where: { id },
    });
  }

  /**
   * Update sections for a job
   */
  async updateSections(id: string, sections: Section[]): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        sections: sections as any, // Prisma JSON type
      },
    });
  }

  /**
   * Confirm sections (set cv_sections_confirmed = true, schema_dirty = false)
   */
  async confirmSections(id: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        cv_sections_confirmed: true,
        schema_dirty: false,
      },
    });
  }

  /**
   * Mark schema as dirty/clean
   */
  async markSchemaDirty(id: string, dirty: boolean): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        schema_dirty: dirty,
      },
    });
  }

  /**
   * Upload resume file metadata
   */
  async uploadResume(id: string, filename: string, blob_path: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        resume_filename: filename,
        resume_blob_path: blob_path,
      },
    });
  }

  /**
   * Upload schema file metadata
   */
  async uploadSchema(id: string, filename: string, blob_path: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        schema_filename: filename,
        schema_blob_path: blob_path,
      },
    });
  }

  /**
   * Upload JD file metadata and text
   */
  async uploadJD(id: string, filename: string, blob_path: string, text: string): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        jd_filename: filename,
        jd_blob_path: blob_path,
        jd_text: text,
      },
    });
  }

  /**
   * List jobs by user (most recent first)
   */
  async listByUser(owner_user_id: string, limit: number = 50): Promise<Job[]> {
    return await this.prisma.job.findMany({
      where: { owner_user_id },
      orderBy: { created_at: "desc" },
      take: limit,
    });
  }

  /**
   * Log a job event (for observability)
   */
  async logEvent(
    job_id: string,
    data: {
      event_type: string;
      trace_id?: string | null;
      payload?: any;
    }
  ): Promise<void> {
    await this.prisma.jobEvent.create({
      data: {
        job_id,
        event_type: data.event_type,
        trace_id: data.trace_id || null,
        payload: data.payload || {},
      },
    });
  }

  /**
   * Update current schema
   */
  async updateSchema(id: string, schema: any): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: {
        current_schema: schema,
      },
    });
  }
}
