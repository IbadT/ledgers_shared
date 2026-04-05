// src/modules/queue/processors/maska-call.processor.ts

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import type { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import type { MaskaCallData } from '../queue.service';

@Processor('maska-calls', {
  concurrency: 5,
})
@Injectable()
export class MaskaCallProcessor extends WorkerHost {
  constructor(private readonly httpService: HttpService) {
    super();
  }

  async process(job: Job<MaskaCallData>): Promise<unknown[]> {
    const { operationId, period, transactions, metadata } = job.data;

    const response = await lastValueFrom(
      this.httpService.post<unknown[]>(
        process.env.MASKA_URL || 'http://maska:3000/enrich',
        {
          operationId,
          period,
          transactions,
          metadata,
        },
        {
          timeout: 20000,
        },
      ),
    );

    return response.data;
  }
}
