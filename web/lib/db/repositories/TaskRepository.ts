// web/lib/db/repositories/TaskRepository.ts
// Phase 5 PR1: Task repository for async operations

import { PrismaClient, Task } from "@prisma/client";

export class TaskRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new task (idempotency scoped to owner)
   */
  async create(data: {
    job_id: string;
    owner_user_id: string;
    idempotency_key: string;
    task_type: string;
    input_payload: any;
    timeout_minutes?: number;
  }): Promise<Task> {
    const timeout_at = new Date(Date.now() + (data.timeout_minutes || 5) * 60 * 1000);

    return await this.prisma.task.create({
      data: {
        job_id: data.job_id,
        owner_user_id: data.owner_user_id,
        idempotency_key: data.idempotency_key,
        task_type: data.task_type,
        status: "queued",
        input_payload: data.input_payload,
        timeout_at,
      },
    });
  }

  /**
   * Find task by idempotency key (with owner isolation)
   */
  async findByIdempotencyKey(
    owner_user_id: string,
    idempotency_key: string
  ): Promise<Task | null> {
    return await this.prisma.task.findUnique({
      where: {
        owner_user_id_idempotency_key: {
          owner_user_id,
          idempotency_key,
        },
      },
    });
  }

  /**
   * Find task by ID (with owner isolation)
   */
  async findById(id: string, owner_user_id: string): Promise<Task | null> {
    return await this.prisma.task.findFirst({
      where: {
        id,
        owner_user_id,
      },
    });
  }

  /**
   * Mark task as running (with owner isolation)
   */
  async markRunning(id: string, owner_user_id: string): Promise<boolean> {
    const result = await this.prisma.task.updateMany({
      where: {
        id,
        owner_user_id,
        status: "queued", // Only transition from queued
      },
      data: {
        status: "running",
        started_at: new Date(),
        stage: "running",
      },
    });

    return result.count > 0;
  }

  /**
   * Update task stage (with owner isolation)
   */
  async updateStage(
    id: string,
    owner_user_id: string,
    stage: string
  ): Promise<void> {
    await this.prisma.task.updateMany({
      where: {
        id,
        owner_user_id,
      },
      data: {
        stage,
      },
    });
  }

  /**
   * Complete task with output (with owner isolation)
   */
  async complete(
    id: string,
    owner_user_id: string,
    output: any
  ): Promise<void> {
    await this.prisma.task.updateMany({
      where: {
        id,
        owner_user_id,
      },
      data: {
        status: "completed",
        stage: "completed",
        output_payload: output,
        completed_at: new Date(),
      },
    });
  }

  /**
   * Fail task with error message (with owner isolation)
   */
  async fail(
    id: string,
    owner_user_id: string,
    error: string
  ): Promise<void> {
    await this.prisma.task.updateMany({
      where: {
        id,
        owner_user_id,
      },
      data: {
        status: "failed",
        error_message: error,
        completed_at: new Date(),
        last_error_at: new Date(),
      },
    });
  }

  /**
   * Increment attempt count and optionally requeue (with owner isolation)
   */
  async incrementAttempt(
    id: string,
    owner_user_id: string,
    error: string,
    requeue: boolean
  ): Promise<void> {
    const task = await this.findById(id, owner_user_id);
    if (!task) return;

    const newAttemptCount = task.attempt_count + 1;
    const shouldFail = newAttemptCount >= task.max_attempts;

    await this.prisma.task.updateMany({
      where: {
        id,
        owner_user_id,
      },
      data: {
        attempt_count: newAttemptCount,
        last_error_at: new Date(),
        error_message: error,
        status: shouldFail ? "failed" : requeue ? "queued" : task.status,
        completed_at: shouldFail ? new Date() : null,
      },
    });
  }

  /**
   * Find all tasks for a job (with owner isolation)
   */
  async findByJobId(
    job_id: string,
    owner_user_id: string,
    limit: number = 50
  ): Promise<Task[]> {
    return await this.prisma.task.findMany({
      where: {
        job_id,
        owner_user_id,
      },
      orderBy: { created_at: "desc" },
      take: limit,
    });
  }

  /**
   * Check for stale tasks (updated_at not progressing)
   * Returns tasks that are running but haven't updated in threshold minutes
   */
  async findStaleTasks(thresholdMinutes: number = 2): Promise<Task[]> {
    const staleThreshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    return await this.prisma.task.findMany({
      where: {
        status: "running",
        updated_at: {
          lt: staleThreshold,
        },
      },
    });
  }

  /**
   * Mark stale task as failed
   */
  async markStaleAsFailed(id: string): Promise<void> {
    await this.prisma.task.updateMany({
      where: {
        id,
        status: "running",
      },
      data: {
        status: "failed",
        error_message: "Task timed out (no progress for 2 minutes)",
        completed_at: new Date(),
      },
    });
  }
}
