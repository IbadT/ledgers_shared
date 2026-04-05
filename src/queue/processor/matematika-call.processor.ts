// src/modules/queue/processors/matematika-call.processor.ts

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import type { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import type { MatematikaCallData } from '../queue.service';

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
  constructor(private readonly httpService: HttpService) {
    super();
  }

  async process(job: Job<MatematikaCallData>): Promise<MatematikaResult> {
    const { operationId, period, context } = job.data;

    try {
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

      return response.data;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.response?.status >= 500) {
        throw error;
      }
      throw new Error(`Matematika call failed: ${error.message}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MatematikaCallData>, error: Error): void {
    console.error(
      `Matematika call failed for ${job.data.period}:`,
      error.message,
    );
  }
}
