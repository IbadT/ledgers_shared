import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import type { MaskaCallData } from '../queue.service';
import { AppLogger } from '../../shared/logger.service';

@Processor('maska-calls', {
  concurrency: 5,
})
@Injectable()
export class MaskaCallProcessor extends WorkerHost {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  async process(job: Job<MaskaCallData>): Promise<unknown[]> {
    const { operationId, period, transactions, metadata } = job.data;

    this.logger.log(
      `[process] Calling Maska: operationId=${operationId}, period=${period}, transactions=${transactions.length}`,
      'MASKA-CALL',
    );

    try {
      this.logger.debug(
        `[process] HTTP POST to Maska: ${process.env.MASKA_URL || 'http://maska:3000/enrich'}`,
        'MASKA-CALL',
      );

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

      this.logger.log(
        `[process] Maska call successful: operationId=${operationId}, period=${period}, enriched=${response.data.length}`,
        'MASKA-CALL',
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `[process] Maska call failed: operationId=${operationId}, period=${period}, error=${error.message}`,
        error.stack,
        'MASKA-CALL',
      );
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MaskaCallData>, error: Error): void {
    this.logger.error(
      `[onFailed] Maska call failed for period=${job.data.period}: ${error.message}`,
      error.stack,
      'MASKA-CALL',
    );
  }
}