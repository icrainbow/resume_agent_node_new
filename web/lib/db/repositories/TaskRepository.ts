// web/lib/db/repositories/TaskRepository.ts
// Phase 5 PR1: Task repository for async operations

import { PrismaClient, Task } from "@prisma/client";

export class TaskRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new task
   */
  async create(data: {
    job_id: string;
    idempotency_key: string;
    task_type: string;
    input_payload: any;
  }): Promise<Task> {
    return await this.prisma.task.create({
      data: {
        job_id: data.job_id,
        idempotency_key: data.idempotency_key,
        task_type: data.task_type,
        status: "pending",
        input_payload: data.input_payload,
      },
    });
  }

  /**
   * Find task by idempotency key (for deduplication)
   */
  async findByIdempotencyKey(key: string): Promise<Task | null> {
    return await this.prisma.task.findUnique({
      where: { idempotency_key: key },
    });
  }

  /**
   * Find task by ID
   */
  async findById(id: string): Promise<Task | null> {
    return await this.prisma.task.findUnique({
      where: { id },
    });
  }

  /**
   * Mark task as running and set started_at
   */
  async markRunning(id: string): Promise<void> {
    await this.prisma.task.update({
      where: { id },
      data: {
        status: "running",
        started_at: new Date(),
        heartbeat_at: new Date(),
      },
    });
  }

  /**
   * Update task heartbeat (worker alive signal)
   */
  async updateHeartbeat(id: string): Promise<void> {
    await this.prisma.task.update({
      where: { id },
      data: {
        heartbeat_at: new Date(),
      },
    });
  }

  /**
   * Complete task with output
   */
  async complete(id: string, output: any): Promise<void> {
    await this.prisma.task.update({
      where: { id },
      data: {
        status: "completed",
        output_payload: output,
        completed_at: new Date(),
      },
    });
  }

  /**
   * Fail task with error message
   */
  async fail(id: string, error: string): Promise<void> {
    await this.prisma.task.update({
      where: { id },
      data: {
        status: "failed",
        error_message: error,
        completed_at: new Date(),
      },
    });
  }

  /**
   * Find pending tasks for worker polling
   */
  async findPendingTasks(limit: number = 10): Promise<Task[]> {
    return await this.prisma.task.findMany({
      where: { status: "pending" },
      orderBy: { created_at: "asc" },
      take: limit,
    });
  }

  /**
   * Find all tasks for a job (for debugging)
   */
  async findByJobId(job_id: string, limit: number = 50): Promise<Task[]> {
    return await this.prisma.task.findMany({
      where: { job_id },
      orderBy: { created_at: "desc" },
      take: limit,
    });
  }
}
