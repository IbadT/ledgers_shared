import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, FlowProducer, type FlowJob } from 'bullmq';
import type { Job } from 'bullmq';
import { AppLogger } from '../shared/logger.service';

// ==========================================
// ИНТЕРФЕЙСЫ
// ==========================================

export interface GenerateMonthJobData {
  operationId: string;
  companyId: string;
  companyName: string;
  accountNumber: string;
  period: string;
  monthIndex: number;
  totalMonths: number;
  initialBalance: number;
  parameters: MonthlyParameters;
  previousPeriod?: string;
}

export interface MatematikaCallData {
  operationId: string;
  period: string;
  context: MatematikaContext;
}

export interface MaskaCallData {
  operationId: string;
  period: string;
  transactions: unknown[];
  metadata: Record<string, unknown>;
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ИНТЕРФЕЙСЫ
// ==========================================

interface MonthlyParameters {
  revenue?: number;
  expenseRatio?: Record<string, number>;
  specialCategories?: string[];
  userOverrides?: {
    initialBalance?: number;
  };
}

interface MatematikaContext {
  initialBalance: number;
  counterparties: CounterpartySelection[];
  datePatterns: DatePatternInfo[];
  forwardInfo?: ForwardingInfo[];
  parameters: MonthlyParameters;
}

interface CounterpartySelection {
  name: string;
  category: string;
  type: 'client' | 'contractor';
  isGreen: boolean;
}

interface DatePatternInfo {
  category: string;
  date: Date;
  pattern: 'fixed' | 'floating';
}

interface ForwardingInfo {
  category: string;
  baseAmount: number;
  variationPercent: number;
  isFixedExact: boolean;
}

// ==========================================
// СЕРВИС
// ==========================================

@Injectable()
export class QueueService {
  private readonly flowProducer: FlowProducer;

  constructor(
    @InjectQueue('statement-generation')
    private readonly generationQueue: Queue<GenerateMonthJobData>,
    @InjectQueue('matematika-calls')
    private readonly matematikaQueue: Queue<MatematikaCallData>,
    @InjectQueue('maska-calls')
    private readonly maskaQueue: Queue<MaskaCallData>,
    private readonly logger: AppLogger,
  ) {
    this.flowProducer = new FlowProducer({
      connection: generationQueue.opts.connection,
    });
    this.logger.log('QueueService initialized', 'QUEUE');
  }

  // ==========================================
  // МЕТОДЫ СОЗДАНИЯ ЗАДАЧ
  // ==========================================

  async createStatementGenerationFlow(
    operationId: string,
    companyId: string,
    companyName: string,
    accountNumber: string,
    startDate: Date,
    monthsCount: number,
    parameters: MonthlyParameters[],
  ): Promise<string> {
    this.logger.log(
      `[createStatementGenerationFlow] Creating flow: operationId=${operationId}, months=${monthsCount}`,
      'QUEUE',
    );
    const flowJobs: FlowJob[] = [];
    let previousJobId: string | undefined;

    for (let i = 0; i < monthsCount; i++) {
      const periodDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + i,
        1,
      );
      const period = this.formatPeriod(periodDate);
      const jobId = `${operationId}#${period}`;

      const flowJob: FlowJob = {
        name: 'generate-month',
        queueName: 'statement-generation',
        opts: {
          jobId,
          priority: monthsCount - i,
        },
        data: {
          operationId,
          companyId,
          companyName,
          accountNumber,
          period,
          monthIndex: i,
          totalMonths: monthsCount,
          initialBalance: 0,
          parameters: parameters[i] || parameters[parameters.length - 1],
          previousPeriod:
            i > 0
              ? this.formatPeriod(
                  new Date(
                    startDate.getFullYear(),
                    startDate.getMonth() + i - 1,
                    1,
                  ),
                )
              : undefined,
        } satisfies GenerateMonthJobData,
      };

      if (previousJobId) {
        flowJob.opts!.parent = {
          id: previousJobId,
          queue: 'statement-generation',
        };
      }

      flowJobs.push(flowJob);
      previousJobId = jobId;
    }

    this.logger.debug(
      `[createStatementGenerationFlow] Adding ${flowJobs.length} jobs to flow`,
      'QUEUE',
    );
    const flow = await this.flowProducer.add({
      name: 'statement-generation-flow',
      queueName: 'statement-generation',
      opts: {
        jobId: `flow#${operationId}`,
      },
      children: flowJobs,
    });

    this.logger.log(
      `[createStatementGenerationFlow] Flow created: flowId=${flow.job.id}`,
      'QUEUE',
    );
    return flow.job.id!;
  }

  async addMonthGenerationJob(
    data: GenerateMonthJobData,
  ): Promise<Job<GenerateMonthJobData>> {
    this.logger.debug(
      `[addMonthGenerationJob] Adding job: operationId=${data.operationId}, period=${data.period}`,
      'QUEUE',
    );
    return this.generationQueue.add('generate-month', data, {
      jobId: `${data.operationId}#${data.period}`,
      priority: data.totalMonths - data.monthIndex,
    });
  }

  async addMatematikaCall(
    data: MatematikaCallData,
  ): Promise<Job<MatematikaCallData>> {
    this.logger.debug(
      `[addMatematikaCall] Adding job: operationId=${data.operationId}, period=${data.period}`,
      'QUEUE',
    );
    return this.matematikaQueue.add('generate-transactions', data, {
      jobId: `matematika#${data.operationId}#${data.period}`,
      attempts: 5,
      backoff: {
        type: 'fixed',
        delay: 10000,
      },
    });
  }

  async addMaskaCall(data: MaskaCallData): Promise<Job<MaskaCallData>> {
    this.logger.debug(
      `[addMaskaCall] Adding job: operationId=${data.operationId}, period=${data.period}`,
      'QUEUE',
    );
    return this.maskaQueue.add('enrich-transactions', data, {
      jobId: `maska#${data.operationId}#${data.period}`,
      attempts: 3,
    });
  }

  // ==========================================
  // МЕТОДЫ МОНИТОРИНГА И УПРАВЛЕНИЯ
  // ==========================================

  async getOperationStatus(operationId: string): Promise<{
    operationId: string;
    status: 'pending' | 'active' | 'completed' | 'failed' | 'mixed';
    progress: {
      total: number;
      completed: number;
      failed: number;
      pending: number;
    };
    months: Array<{
      period: string;
      status: string;
      progress?: number;
    }>;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.generationQueue.getJobs(['waiting', 'delayed']),
      this.generationQueue.getJobs(['active']),
      this.generationQueue.getJobs(['completed']),
      this.generationQueue.getJobs(['failed']),
    ]);

    const allJobs = [...waiting, ...active, ...completed, ...failed].filter(
      (job) => job.id?.startsWith(operationId),
    );

    const months = allJobs.map((job) => ({
      period: job.data.period,
      status: this.determineJobStatus(job),
      progress: job.progress as number | undefined,
    }));

    const completedCount = allJobs.filter(
      (j) => j.finishedOn && !j.failedReason,
    ).length;
    const failedCount = allJobs.filter((j) => j.failedReason).length;
    const pendingCount = allJobs.filter((j) => !j.processedOn).length;

    let status: 'pending' | 'active' | 'completed' | 'failed' | 'mixed';
    if (failedCount === allJobs.length) status = 'failed';
    else if (completedCount === allJobs.length) status = 'completed';
    else if (pendingCount === allJobs.length) status = 'pending';
    else if (active.length > 0) status = 'active';
    else status = 'mixed';

    return {
      operationId,
      status,
      progress: {
        total: allJobs.length,
        completed: completedCount,
        failed: failedCount,
        pending: pendingCount,
      },
      months,
    };
  }

  async getJob(
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
    jobId: string,
  ): Promise<Job | undefined> {
    const queue = {
      'statement-generation': this.generationQueue,
      'matematika-calls': this.matematikaQueue,
      'maska-calls': this.maskaQueue,
    }[queueName];

    return queue.getJob(jobId);
  }

  async cancelOperation(operationId: string): Promise<{
    removed: number;
    errors: string[];
  }> {
    this.logger.log(
      `[cancelOperation] Cancelling operation: operationId=${operationId}`,
      'QUEUE',
    );
    const errors: string[] = [];
    let removed = 0;

    const [waiting, delayed] = await Promise.all([
      this.generationQueue.getJobs(['waiting']),
      this.generationQueue.getJobs(['delayed']),
    ]);

    const toCancel = [...waiting, ...delayed].filter((job) =>
      job.id?.startsWith(operationId),
    );

    this.logger.debug(
      `[cancelOperation] Found ${toCancel.length} jobs to cancel`,
      'QUEUE',
    );

    for (const job of toCancel) {
      try {
        await job.remove();
        removed++;
        this.logger.debug(`[cancelOperation] Removed job: ${job.id}`, 'QUEUE');
      } catch (error: any) {
        errors.push(`Failed to remove job ${job.id}: ${error.message}`);
        this.logger.error(
          `[cancelOperation] Failed to remove job ${job.id}: ${error.message}`,
          error.stack,
          'QUEUE',
        );
      }
    }

    this.logger.log(
      `[cancelOperation] Cancelled: removed=${removed}, errors=${errors.length}`,
      'QUEUE',
    );
    return { removed, errors };
  }

  async retryFailed(operationId: string): Promise<number> {
    this.logger.log(
      `[retryFailed] Retrying failed jobs: operationId=${operationId}`,
      'QUEUE',
    );
    const failed = await this.generationQueue.getFailed();
    const toRetry = failed.filter((job) => job.id?.startsWith(operationId));

    this.logger.debug(
      `[retryFailed] Found ${toRetry.length} failed jobs to retry`,
      'QUEUE',
    );

    let retried = 0;
    for (const job of toRetry) {
      await job.retry();
      retried++;
      this.logger.debug(`[retryFailed] Retried job: ${job.id}`, 'QUEUE');
    }

    this.logger.log(`[retryFailed] Retried ${retried} jobs`, 'QUEUE');
    return retried;
  }

  async cleanOldJobs(
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
    gracePeriodMs: number = 24 * 3600 * 1000,
  ): Promise<void> {
    const queue = {
      'statement-generation': this.generationQueue,
      'matematika-calls': this.matematikaQueue,
      'maska-calls': this.maskaQueue,
    }[queueName];

    await queue.clean(gracePeriodMs, 100, 'completed');
    await queue.clean(gracePeriodMs, 100, 'failed');
  }

  async pauseQueue(
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
  ): Promise<void> {
    const queue = {
      'statement-generation': this.generationQueue,
      'matematika-calls': this.matematikaQueue,
      'maska-calls': this.maskaQueue,
    }[queueName];

    await queue.pause();
  }

  async resumeQueue(
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
  ): Promise<void> {
    const queue = {
      'statement-generation': this.generationQueue,
      'matematika-calls': this.matematikaQueue,
      'maska-calls': this.maskaQueue,
    }[queueName];

    await queue.resume();
  }

  async getQueueMetrics(
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
  ): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }> {
    this.logger.debug(`[getQueueMetrics] Getting metrics: queue=${queueName}`, 'QUEUE');
    const queue = {
      'statement-generation': this.generationQueue,
      'matematika-calls': this.matematikaQueue,
      'maska-calls': this.maskaQueue,
    }[queueName];

    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );

    this.logger.debug(
      `[getQueueMetrics] Metrics: waiting=${counts.waiting}, active=${counts.active}, completed=${counts.completed}, failed=${counts.failed}`,
      'QUEUE',
    );

    return {
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: counts.paused,
    };
  }

  // ==========================================
  // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
  // ==========================================

  private determineJobStatus(job: Job): string {
    if (job.failedReason) return 'failed';
    if (job.finishedOn) return 'completed';
    if (job.processedOn) return 'active';
    return 'pending';
  }

  private formatPeriod(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
