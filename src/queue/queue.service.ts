// src/modules/queue/queue.service.ts

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, FlowProducer, type FlowJob } from 'bullmq';
import type { Job } from 'bullmq';

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
  ) {
    this.flowProducer = new FlowProducer({
      connection: generationQueue.opts.connection,
    });
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
    const flowJobs: FlowJob[] = [];
    let previousJobId: string | undefined;

    for (let i = 0; i < monthsCount; i++) {
      const periodDate = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + i,
        1,
      );
      const period = this.formatPeriod(periodDate);
      const jobId = `${operationId}:${period}`;

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

    const flow = await this.flowProducer.add({
      name: 'statement-generation-flow',
      queueName: 'statement-generation',
      opts: {
        jobId: `flow:${operationId}`,
      },
      children: flowJobs,
    });

    return flow.job.id!;
  }

  async addMonthGenerationJob(
    data: GenerateMonthJobData,
  ): Promise<Job<GenerateMonthJobData>> {
    return this.generationQueue.add('generate-month', data, {
      jobId: `${data.operationId}:${data.period}`,
      priority: data.totalMonths - data.monthIndex,
    });
  }

  async addMatematikaCall(
    data: MatematikaCallData,
  ): Promise<Job<MatematikaCallData>> {
    return this.matematikaQueue.add('generate-transactions', data, {
      jobId: `matematika:${data.operationId}:${data.period}`,
      attempts: 5,
      backoff: {
        type: 'fixed',
        delay: 10000,
      },
    });
  }

  async addMaskaCall(data: MaskaCallData): Promise<Job<MaskaCallData>> {
    return this.maskaQueue.add('enrich-transactions', data, {
      jobId: `maska:${data.operationId}:${data.period}`,
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
    const errors: string[] = [];
    let removed = 0;

    const [waiting, delayed] = await Promise.all([
      this.generationQueue.getJobs(['waiting']),
      this.generationQueue.getJobs(['delayed']),
    ]);

    const toCancel = [...waiting, ...delayed].filter((job) =>
      job.id?.startsWith(operationId),
    );

    for (const job of toCancel) {
      try {
        await job.remove();
        removed++;
      } catch (error: any) {
        errors.push(`Failed to remove job ${job.id}: ${error.message}`);
      }
    }

    return { removed, errors };
  }

  async retryFailed(operationId: string): Promise<number> {
    const failed = await this.generationQueue.getFailed();
    const toRetry = failed.filter((job) => job.id?.startsWith(operationId));

    let retried = 0;
    for (const job of toRetry) {
      await job.retry();
      retried++;
    }

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
    const queue = {
      'statement-generation': this.generationQueue,
      'matematika-calls': this.matematikaQueue,
      'maska-calls': this.maskaQueue,
    }[queueName];

    // Используем getJobCounts вместо отдельных методов
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
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

// // src/modules/queue/queue.service.ts

// import { Injectable } from '@nestjs/common';
// import { InjectQueue } from '@nestjs/bullmq';
// import { Queue, FlowProducer, type FlowJob } from 'bullmq';
// import type { Job } from 'bullmq';

// // ==========================================
// // ИНТЕРФЕЙСЫ
// // ==========================================

// export interface GenerateMonthJobData {
//   operationId: string;
//   companyId: string;
//   companyName: string;
//   accountNumber: string;
//   period: string;
//   monthIndex: number;
//   totalMonths: number;
//   initialBalance: number;
//   parameters: MonthlyParameters;
//   previousPeriod?: string;
// }

// export interface MatematikaCallData {
//   operationId: string;
//   period: string;
//   context: MatematikaContext;
// }

// export interface MaskaCallData {
//   operationId: string;
//   period: string;
//   transactions: unknown[];
//   metadata: Record<string, unknown>;
// }

// // ==========================================
// // ВСПОМОГАТЕЛЬНЫЕ ИНТЕРФЕЙСЫ (не экспортируются)
// // ==========================================

// interface MonthlyParameters {
//   revenue?: number;
//   expenseRatio?: Record<string, number>;
//   specialCategories?: string[];
//   userOverrides?: {
//     initialBalance?: number;
//   };
// }

// interface MatematikaContext {
//   initialBalance: number;
//   counterparties: CounterpartySelection[];
//   datePatterns: DatePatternInfo[];
//   forwardInfo?: ForwardingInfo[];
//   parameters: MonthlyParameters;
// }

// interface CounterpartySelection {
//   name: string;
//   category: string;
//   type: 'client' | 'contractor';
//   isGreen: boolean;
// }

// interface DatePatternInfo {
//   category: string;
//   date: Date;
//   pattern: 'fixed' | 'floating';
// }

// interface ForwardingInfo {
//   category: string;
//   baseAmount: number;
//   variationPercent: number;
//   isFixedExact: boolean;
// }

// // ==========================================
// // СЕРВИС
// // ==========================================

// @Injectable()
// export class QueueService {
//   private readonly flowProducer: FlowProducer;

//   constructor(
//     @InjectQueue('statement-generation')
//     private readonly generationQueue: Queue<GenerateMonthJobData>,
//     @InjectQueue('matematika-calls')
//     private readonly matematikaQueue: Queue<MatematikaCallData>,
//     @InjectQueue('maska-calls')
//     private readonly maskaQueue: Queue<MaskaCallData>,
//   ) {
//     this.flowProducer = new FlowProducer({
//       connection: generationQueue.opts.connection,
//     });
//   }

//   // ==========================================
//   // МЕТОДЫ СОЗДАНИЯ ЗАДАЧ
//   // ==========================================

//   async createStatementGenerationFlow(
//     operationId: string,
//     companyId: string,
//     companyName: string,
//     accountNumber: string,
//     startDate: Date,
//     monthsCount: number,
//     parameters: MonthlyParameters[],
//   ): Promise<string> {
//     const flowJobs: FlowJob[] = [];
//     let previousJobId: string | undefined;

//     for (let i = 0; i < monthsCount; i++) {
//       const periodDate = new Date(
//         startDate.getFullYear(),
//         startDate.getMonth() + i,
//         1,
//       );
//       const period = this.formatPeriod(periodDate);
//       const jobId = `${operationId}:${period}`;

//       const flowJob: FlowJob = {
//         name: 'generate-month',
//         queueName: 'statement-generation',
//         opts: {
//           jobId,
//           priority: monthsCount - i,
//         },
//         data: {
//           operationId,
//           companyId,
//           companyName,
//           accountNumber,
//           period,
//           monthIndex: i,
//           totalMonths: monthsCount,
//           initialBalance: 0,
//           parameters: parameters[i] || parameters[parameters.length - 1],
//           previousPeriod:
//             i > 0
//               ? this.formatPeriod(
//                   new Date(
//                     startDate.getFullYear(),
//                     startDate.getMonth() + i - 1,
//                     1,
//                   ),
//                 )
//               : undefined,
//         } satisfies GenerateMonthJobData,
//       };

//       if (previousJobId) {
//         flowJob.opts!.parent = {
//           id: previousJobId,
//           queue: 'statement-generation',
//         };
//       }

//       flowJobs.push(flowJob);
//       previousJobId = jobId;
//     }

//     const flow = await this.flowProducer.add({
//       name: 'statement-generation-flow',
//       queueName: 'statement-generation',
//       opts: {
//         jobId: `flow:${operationId}`,
//       },
//       children: flowJobs,
//     });

//     return flow.job.id!;
//   }

//   async addMonthGenerationJob(
//     data: GenerateMonthJobData,
//   ): Promise<Job<GenerateMonthJobData>> {
//     return this.generationQueue.add('generate-month', data, {
//       jobId: `${data.operationId}:${data.period}`,
//       priority: data.totalMonths - data.monthIndex,
//     });
//   }

//   async addMatematikaCall(
//     data: MatematikaCallData,
//   ): Promise<Job<MatematikaCallData>> {
//     return this.matematikaQueue.add('generate-transactions', data, {
//       jobId: `matematika:${data.operationId}:${data.period}`,
//       attempts: 5,
//       backoff: {
//         type: 'fixed',
//         delay: 10000,
//       },
//     });
//   }

//   async addMaskaCall(data: MaskaCallData): Promise<Job<MaskaCallData>> {
//     return this.maskaQueue.add('enrich-transactions', data, {
//       jobId: `maska:${data.operationId}:${data.period}`,
//       attempts: 3,
//     });
//   }

//   // ==========================================
//   // МЕТОДЫ МОНИТОРИНГА И УПРАВЛЕНИЯ
//   // ==========================================

//   async getOperationStatus(operationId: string): Promise<{
//     operationId: string;
//     status: 'pending' | 'active' | 'completed' | 'failed' | 'mixed';
//     progress: {
//       total: number;
//       completed: number;
//       failed: number;
//       pending: number;
//     };
//     months: Array<{
//       period: string;
//       status: string;
//       progress?: number;
//     }>;
//   }> {
//     const [waiting, active, completed, failed] = await Promise.all([
//       this.generationQueue.getJobs(['waiting', 'delayed']),
//       this.generationQueue.getJobs(['active']),
//       this.generationQueue.getJobs(['completed']),
//       this.generationQueue.getJobs(['failed']),
//     ]);

//     const allJobs = [...waiting, ...active, ...completed, ...failed].filter(
//       (job) => job.id?.startsWith(operationId),
//     );

//     const months = allJobs.map((job) => ({
//       period: job.data.period,
//       status: this.determineJobStatus(job),
//       progress: job.progress as number | undefined,
//     }));

//     const completedCount = allJobs.filter(
//       (j) => j.finishedOn && !j.failedReason,
//     ).length;
//     const failedCount = allJobs.filter((j) => j.failedReason).length;
//     const pendingCount = allJobs.filter((j) => !j.processedOn).length;

//     let status: 'pending' | 'active' | 'completed' | 'failed' | 'mixed';
//     if (failedCount === allJobs.length) status = 'failed';
//     else if (completedCount === allJobs.length) status = 'completed';
//     else if (pendingCount === allJobs.length) status = 'pending';
//     else if (active.length > 0) status = 'active';
//     else status = 'mixed';

//     return {
//       operationId,
//       status,
//       progress: {
//         total: allJobs.length,
//         completed: completedCount,
//         failed: failedCount,
//         pending: pendingCount,
//       },
//       months,
//     };
//   }

//   async getJob(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//     jobId: string,
//   ): Promise<Job | undefined> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     return queue.getJob(jobId);
//   }

//   async cancelOperation(operationId: string): Promise<{
//     removed: number;
//     errors: string[];
//   }> {
//     const errors: string[] = [];
//     let removed = 0;

//     const [waiting, delayed] = await Promise.all([
//       this.generationQueue.getJobs(['waiting']),
//       this.generationQueue.getJobs(['delayed']),
//     ]);

//     const toCancel = [...waiting, ...delayed].filter((job) =>
//       job.id?.startsWith(operationId),
//     );

//     for (const job of toCancel) {
//       try {
//         await job.remove();
//         removed++;
//       } catch (error: any) {
//         errors.push(`Failed to remove job ${job.id}: ${error.message}`);
//       }
//     }

//     return { removed, errors };
//   }

//   async retryFailed(operationId: string): Promise<number> {
//     const failed = await this.generationQueue.getFailed();
//     const toRetry = failed.filter((job) => job.id?.startsWith(operationId));

//     let retried = 0;
//     for (const job of toRetry) {
//       await job.retry();
//       retried++;
//     }

//     return retried;
//   }

//   async cleanOldJobs(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//     gracePeriodMs: number = 24 * 3600 * 1000,
//   ): Promise<void> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     await queue.clean(gracePeriodMs, 100, 'completed');
//     await queue.clean(gracePeriodMs, 100, 'failed');
//   }

//   async pauseQueue(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//   ): Promise<void> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     await queue.pause();
//   }

//   async resumeQueue(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//   ): Promise<void> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     await queue.resume();
//   }

//   async getQueueMetrics(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//   ): Promise<{
//     waiting: number;
//     active: number;
//     completed: number;
//     failed: number;
//     delayed: number;
//     paused: number;
//   }> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     const [waiting, active, completed, failed, delayed, paused] =
//       await Promise.all([
//         queue.getWaitingCount(),
//         queue.getActiveCount(),
//         queue.getCompletedCount(),
//         queue.getFailedCount(),
//         queue.getDelayedCount(),
//         queue.getPausedCount(),
//       ]);

//     return {
//       waiting,
//       active,
//       completed,
//       failed,
//       delayed,
//       paused,
//     };
//   }

//   // ==========================================
//   // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
//   // ==========================================

//   private determineJobStatus(job: Job): string {
//     if (job.failedReason) return 'failed';
//     if (job.finishedOn) return 'completed';
//     if (job.processedOn) return 'active';
//     return 'pending';
//   }

//   private formatPeriod(date: Date): string {
//     return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
//   }
// }

// // src/modules/queue/queue.service.ts

// import { Injectable } from '@nestjs/common';
// import { InjectQueue } from '@nestjs/bullmq';
// import { Queue, FlowProducer, type FlowJob } from 'bullmq';
// import type { Job } from 'bullmq';

// // Интерфейсы job данных
// export interface GenerateMonthJobData {
//   operationId: string;
//   companyId: string;
//   companyName: string;
//   accountNumber: string;
//   period: string; // "2025-01"
//   monthIndex: number;
//   totalMonths: number;
//   initialBalance: number;
//   parameters: MonthlyParameters;
//   previousPeriod?: string; // Для наследования контрагентов
// }

// export interface MatematikaCallData {
//   operationId: string;
//   period: string;
//   context: MatematikaContext;
// }

// export interface MaskaCallData {
//   operationId: string;
//   period: string;
//   transactions: unknown[];
//   metadata: Record<string, unknown>;
// }

// interface MonthlyParameters {
//   revenue?: number;
//   expenseRatio?: Record<string, number>;
//   specialCategories?: string[];
//   userOverrides?: {
//     initialBalance?: number;
//   };
// }

// interface MatematikaContext {
//   period: string;
//   initialBalance: number;
//   counterparties: CounterpartySelection[];
//   datePatterns: DatePatternInfo[];
//   forwardInfo?: ForwardingInfo[];
//   parameters: MonthlyParameters;
// }

// interface CounterpartySelection {
//   name: string;
//   category: string;
//   type: 'client' | 'contractor';
//   isGreen: boolean;
// }

// interface DatePatternInfo {
//   category: string;
//   date: Date;
//   pattern: 'fixed' | 'floating';
// }

// interface ForwardingInfo {
//   category: string;
//   baseAmount: number;
//   variationPercent: number;
//   isFixedExact: boolean;
// }

// @Injectable()
// export class QueueService {
//   private readonly flowProducer: FlowProducer;

//   constructor(
//     @InjectQueue('statement-generation')
//     private readonly generationQueue: Queue<GenerateMonthJobData>,
//     @InjectQueue('matematika-calls')
//     private readonly matematikaQueue: Queue<MatematikaCallData>,
//     @InjectQueue('maska-calls')
//     private readonly maskaQueue: Queue<MaskaCallData>,
//   ) {
//     this.flowProducer = new FlowProducer({
//       connection: generationQueue.opts.connection,
//     });
//   }

//   /**
//    * Создает Flow для генерации выписок за несколько месяцев
//    * Каждый месяц — отдельный job, зависящий от предыдущего (для наследования баланса)
//    */
//   async createStatementGenerationFlow(
//     operationId: string,
//     companyId: string,
//     companyName: string,
//     accountNumber: string,
//     startDate: Date,
//     monthsCount: number,
//     parameters: MonthlyParameters[],
//   ): Promise<string> {
//     const flowJobs: FlowJob[] = [];
//     let previousJobId: string | undefined;

//     for (let i = 0; i < monthsCount; i++) {
//       const periodDate = new Date(
//         startDate.getFullYear(),
//         startDate.getMonth() + i,
//         1,
//       );
//       const period = this.formatPeriod(periodDate);

//       const jobId = `${operationId}:${period}`;

//       const flowJob: FlowJob = {
//         name: 'generate-month',
//         queueName: 'statement-generation',
//         opts: {
//           jobId,
//           priority: monthsCount - i, // Первые месяцы приоритетнее
//         },
//         data: {
//           operationId,
//           companyId,
//           companyName,
//           accountNumber,
//           period,
//           monthIndex: i,
//           totalMonths: monthsCount,
//           initialBalance: 0, // Будет определен в процессоре или из предыдущего
//           parameters: parameters[i] || parameters[parameters.length - 1],
//           previousPeriod:
//             i > 0
//               ? this.formatPeriod(
//                   new Date(
//                     startDate.getFullYear(),
//                     startDate.getMonth() + i - 1,
//                     1,
//                   ),
//                 )
//               : undefined,
//         } satisfies GenerateMonthJobData,
//         // Зависимость от предыдущего месяца для последовательности
//         ...(previousJobId && {
//           children: [], // BullMQ Flow сам разрешит через opts.parent
//         }),
//       };

//       // Добавляем parent опцию для зависимости
//       if (previousJobId) {
//         flowJob.opts!.parent = {
//           id: previousJobId,
//           queue: 'statement-generation',
//         };
//       }

//       flowJobs.push(flowJob);
//       previousJobId = jobId;
//     }

//     const flow = await this.flowProducer.add({
//       name: 'statement-generation-flow',
//       queueName: 'statement-generation',
//       opts: {
//         jobId: `flow:${operationId}`,
//       },
//       children: flowJobs,
//     });

//     return flow.job.id!;
//   }

//   /**
//    * Добавить standalone job генерации месяца (без Flow)
//    */
//   async addMonthGenerationJob(
//     data: GenerateMonthJobData,
//   ): Promise<Job<GenerateMonthJobData>> {
//     return this.generationQueue.add('generate-month', data, {
//       jobId: `${data.operationId}:${data.period}`,
//       priority: data.totalMonths - data.monthIndex,
//     });
//   }

//   /**
//    * Добавить вызов Matematika с надежными retries
//    */
//   async addMatematikaCall(
//     data: MatematikaCallData,
//   ): Promise<Job<MatematikaCallData>> {
//     return this.matematikaQueue.add('generate-transactions', data, {
//       jobId: `matematika:${data.operationId}:${data.period}`,
//       attempts: 5,
//       backoff: {
//         type: 'fixed',
//         delay: 10000,
//       },
//     });
//   }

//   /**
//    * Добавить вызов Maska
//    */
//   async addMaskaCall(data: MaskaCallData): Promise<Job<MaskaCallData>> {
//     return this.maskaQueue.add('enrich-transactions', data, {
//       jobId: `maska:${data.operationId}:${data.period}`,
//       attempts: 3,
//     });
//   }

//   /**
//    * Получить статус операции по всем месяцам
//    */
//   async getOperationStatus(operationId: string): Promise<{
//     operationId: string;
//     status: 'pending' | 'active' | 'completed' | 'failed' | 'mixed';
//     progress: {
//       total: number;
//       completed: number;
//       failed: number;
//       pending: number;
//     };
//     months: Array<{
//       period: string;
//       status: string;
//       progress?: number;
//     }>;
//   }> {
//     const pattern = `${operationId}:*`;

//     // Получаем все jobs операции
//     const [waiting, active, completed, failed] = await Promise.all([
//       this.generationQueue.getJobs(['waiting', 'delayed']),
//       this.generationQueue.getJobs(['active']),
//       this.generationQueue.getJobs(['completed']),
//       this.generationQueue.getJobs(['failed']),
//     ]);

//     const allJobs = [...waiting, ...active, ...completed, ...failed].filter(
//       (job) => job.id?.startsWith(operationId),
//     );

//     const months = allJobs.map((job) => ({
//       period: job.data.period,
//       status: this.determineJobStatus(job),
//       progress: job.progress as number | undefined,
//     }));

//     const completedCount = allJobs.filter(
//       (j) => j.finishedOn && !j.failedReason,
//     ).length;
//     const failedCount = allJobs.filter((j) => j.failedReason).length;
//     const pendingCount = allJobs.filter((j) => !j.processedOn).length;

//     let status: 'pending' | 'active' | 'completed' | 'failed' | 'mixed';
//     if (failedCount === allJobs.length) status = 'failed';
//     else if (completedCount === allJobs.length) status = 'completed';
//     else if (pendingCount === allJobs.length) status = 'pending';
//     else if (active.length > 0) status = 'active';
//     else status = 'mixed';

//     return {
//       operationId,
//       status,
//       progress: {
//         total: allJobs.length,
//         completed: completedCount,
//         failed: failedCount,
//         pending: pendingCount,
//       },
//       months,
//     };
//   }

//   /**
//    * Получить конкретный job
//    */
//   async getJob(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//     jobId: string,
//   ): Promise<Job | undefined> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     return queue.getJob(jobId);
//   }

//   /**
//    * Отменить операцию (удалить все pending jobs)
//    */
//   async cancelOperation(operationId: string): Promise<{
//     removed: number;
//     errors: string[];
//   }> {
//     const errors: string[] = [];
//     let removed = 0;

//     const [waiting, delayed] = await Promise.all([
//       this.generationQueue.getJobs(['waiting']),
//       this.generationQueue.getJobs(['delayed']),
//     ]);

//     const toCancel = [...waiting, ...delayed].filter((job) =>
//       job.id?.startsWith(operationId),
//     );

//     for (const job of toCancel) {
//       try {
//         await job.remove();
//         removed++;
//       } catch (error) {
//         errors.push(`Failed to remove job ${job.id}: ${error.message}`);
//       }
//     }

//     return { removed, errors };
//   }

//   /**
//    * Повторить failed job
//    */
//   async retryFailed(operationId: string): Promise<number> {
//     const failed = await this.generationQueue.getFailed();
//     const toRetry = failed.filter((job) => job.id?.startsWith(operationId));

//     let retried = 0;
//     for (const job of toRetry) {
//       await job.retry();
//       retried++;
//     }

//     return retried;
//   }

//   /**
//    * Очистить старые завершенные jobs
//    */
//   async cleanOldJobs(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//     gracePeriodMs: number = 24 * 3600 * 1000,
//   ): Promise<void> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     await queue.clean(gracePeriodMs, 100, 'completed');
//     await queue.clean(gracePeriodMs, 100, 'failed');
//   }

//   /**
//    * Пауза/возобновление очереди
//    */
//   async pauseQueue(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//   ): Promise<void> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     await queue.pause();
//   }

//   async resumeQueue(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//   ): Promise<void> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     await queue.resume();
//   }

//   /**
//    * Получить метрики очереди
//    */
//   async getQueueMetrics(
//     queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
//   ): Promise<{
//     waiting: number;
//     active: number;
//     completed: number;
//     failed: number;
//     delayed: number;
//     paused: number;
//   }> {
//     const queue = {
//       'statement-generation': this.generationQueue,
//       'matematika-calls': this.matematikaQueue,
//       'maska-calls': this.maskaQueue,
//     }[queueName];

//     const [waiting, active, completed, failed, delayed, paused] =
//       await Promise.all([
//         queue.getWaitingCount(),
//         queue.getActiveCount(),
//         queue.getCompletedCount(),
//         queue.getFailedCount(),
//         queue.getDelayedCount(),
//         queue.getPausedCount(),
//       ]);

//     return {
//       waiting,
//       active,
//       completed,
//       failed,
//       delayed,
//       paused,
//     };
//   }

//   private determineJobStatus(job: Job): string {
//     if (job.failedReason) return 'failed';
//     if (job.finishedOn) return 'completed';
//     if (job.processedOn) return 'active';
//     return 'pending';
//   }

//   private formatPeriod(date: Date): string {
//     return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
//   }
// }
