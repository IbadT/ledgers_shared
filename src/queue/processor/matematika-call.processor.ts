import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import type { MatematikaCallData } from '../queue.service';
import { AppLogger } from '../../shared/logger.service';

interface MatematikaResult {
  finalBalance: number;
  transactions: Array<{
    id: string;
    date: Date;
    amount: number;
    type: 'income' | 'expense';
    category: string;
    counterparty: string;
    description?: string;
  }>;
}

@Processor('matematika-calls', {
  concurrency: 5,
})
@Injectable()
export class MatematikaCallProcessor extends WorkerHost {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job<MatematikaCallData>): Promise<MatematikaResult> {
    const { operationId, period, context } = job.data;

    this.logger.log(
      `[process] Calling Matematika: operationId=${operationId}, period=${period}`,
      'MATEMATIKA-CALL',
    );

    try {
      this.logger.debug(
        `[process] HTTP POST to Matematika: ${process.env.MATEMATIKA_URL || 'http://matematika:3000/generate'}`,
        'MATEMATIKA-CALL',
      );

      const response = await lastValueFrom(
        this.httpService.post<MatematikaResult>(
          process.env.MATEMATIKA_URL || 'http://matematika:3000/generate',
          {
            operationId,
            period,
            ...context,
          },
          {
            timeout: 25000,
            headers: {
              'X-Idempotency-Key': `${operationId}:${period}`,
            },
          },
        ),
      );

      this.logger.log(
        `[process] Matematika call successful: operationId=${operationId}, period=${period}, transactions=${response.data.transactions.length}`,
        'MATEMATIKA-CALL',
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `[process] Matematika call failed: operationId=${operationId}, period=${period}, error=${error.message}`,
        error.stack,
        'MATEMATIKA-CALL',
      );
      if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
        throw error;
      }
      throw new Error(`Matematika call failed: ${error.message}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MatematikaCallData>, error: Error): void {
    this.logger.error(
      `[onFailed] Matematika call failed for period=${job.data.period}: ${error.message}`,
      error.stack,
      'MATEMATIKA-CALL',
    );
  }
}
