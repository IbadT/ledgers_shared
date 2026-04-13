import { Injectable } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateStatementDto } from './dto/generate-statemtnt.dto';
import { JobStatus } from '../../prisma/generated/enums';
import { AppLogger } from '../shared/logger.service';

@Injectable()
export class OrcestratorService {
  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  async generate(dto: GenerateStatementDto): Promise<{
    operationId: string;
    status: string;
    message: string;
  }> {
    const operationId = this.generateOperationId(dto);
    this.logger.log(
      `[generate] Starting generation for company=${dto.companyId}, operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );

    // Проверяем существующую операцию (идемпотентность)
    this.logger.debug(
      `[generate] Checking existing job for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    const existingJob = await this.prisma.orchestrationJob.findUnique({
      where: { operationId },
    });

    if (existingJob) {
      this.logger.warn(
        `[generate] Operation already exists: operationId=${operationId}, status=${existingJob.status}`,
        'ORCESTRATOR-SERVICE',
      );
      return {
        operationId,
        status: existingJob.status.toLowerCase(),
        message: `Operation already exists with status: ${existingJob.status}`,
      };
    }

    // Создаем запись в БД
    this.logger.debug(
      `[generate] Creating database record for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    await this.prisma.orchestrationJob.create({
      data: {
        operationId,
        companyId: dto.companyId,
        companyName: dto.companyName,
        accountNumber: dto.accountNumber,
        startDate: new Date(dto.startDate),
        monthsCount: dto.monthsCount,
        totalMonths: dto.monthsCount,
        parameters: dto.parameters,
        status: JobStatus.PENDING,
      },
    });
    this.logger.log(
      `[generate] Database record created for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );

    // Создаем Flow генерации в BullMQ
    this.logger.debug(
      `[generate] Creating BullMQ flow for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    await this.queueService.createStatementGenerationFlow(
      operationId,
      dto.companyId,
      dto.companyName,
      dto.accountNumber,
      new Date(dto.startDate),
      dto.monthsCount,
      dto.parameters,
    );
    this.logger.log(
      `[generate] BullMQ flow created for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );

    // Обновляем статус
    this.logger.debug(
      `[generate] Updating status to PROCESSING for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    await this.prisma.orchestrationJob.update({
      where: { operationId },
      data: { status: JobStatus.PROCESSING },
    });

    this.logger.log(
      `[generate] Generation started successfully: operationId=${operationId}, months=${dto.monthsCount}`,
      'ORCESTRATOR-SERVICE',
    );

    return {
      operationId,
      status: 'accepted',
      message: `Generation started for ${dto.monthsCount} months`,
    };
  }

  async getStatus(operationId: string) {
    this.logger.debug(
      `[getStatus] Fetching status for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    const [dbJob, queueStatus] = await Promise.all([
      this.prisma.orchestrationJob.findUnique({
        where: { operationId },
        include: { monthResults: true },
      }),
      this.queueService.getOperationStatus(operationId),
    ]);

    if (!dbJob) {
      this.logger.warn(
        `[getStatus] Operation not found: operationId=${operationId}`,
        'ORCESTRATOR-SERVICE',
      );
      return { error: 'Operation not found' };
    }

    this.logger.debug(
      `[getStatus] Status retrieved: operationId=${operationId}, status=${dbJob.status}, completedMonths=${dbJob.monthResults.length}`,
      'ORCESTRATOR-SERVICE',
    );

    return {
      operationId: dbJob.operationId,
      status: dbJob.status,
      progress: {
        currentMonth: dbJob.currentMonth,
        totalMonths: dbJob.totalMonths,
        completedMonths: dbJob.monthResults.length,
      },
      queueStatus,
      createdAt: dbJob.createdAt,
      updatedAt: dbJob.updatedAt,
      completedAt: dbJob.completedAt,
    };
  }

  async cancel(operationId: string): Promise<{ removed: number; errors: string[] }> {
    this.logger.log(
      `[cancel] Cancelling operation: operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    const result = await this.queueService.cancelOperation(operationId);
    
    this.logger.debug(
      `[cancel] Updating status to CANCELLED for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    await this.prisma.orchestrationJob.update({
      where: { operationId },
      data: { status: JobStatus.CANCELLED },
    });

    this.logger.log(
      `[cancel] Operation cancelled: operationId=${operationId}, removed=${result.removed} jobs`,
      'ORCESTRATOR-SERVICE',
    );
    return result;
  }

  async retry(operationId: string): Promise<{ retried: number }> {
    this.logger.log(
      `[retry] Retrying operation: operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    const retried = await this.queueService.retryFailed(operationId);
    
    if (retried > 0) {
      this.logger.debug(
        `[retry] Updating status to PROCESSING for operationId=${operationId}`,
        'ORCESTRATOR-SERVICE',
      );
      await this.prisma.orchestrationJob.update({
        where: { operationId },
        data: { status: JobStatus.PROCESSING },
      });
    }

    this.logger.log(
      `[retry] Retry completed: operationId=${operationId}, retried=${retried} jobs`,
      'ORCESTRATOR-SERVICE',
    );
    return { retried };
  }

  async getMetrics(
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
  ) {
    this.logger.debug(
      `[getMetrics] Fetching metrics for queue=${queueName}`,
      'ORCESTRATOR-SERVICE',
    );
    return this.queueService.getQueueMetrics(queueName);
  }

  async getResult(operationId: string): Promise<{
    companyName: string;
    accountNumber: string;
    periods: Array<{
      period: string;
      initialBalance: number;
      closingBalance: number;
      transactions: unknown[];
    }>;
    status: string;
  } | { error: string }> {
    this.logger.log(
      `[getResult] Fetching result for operationId=${operationId}`,
      'ORCESTRATOR-SERVICE',
    );
    const dbJob = await this.prisma.orchestrationJob.findUnique({
      where: { operationId },
      include: {
        monthResults: {
          orderBy: { period: 'asc' },
        },
      },
    });

    if (!dbJob) {
      this.logger.warn(
        `[getResult] Operation not found: operationId=${operationId}`,
        'ORCESTRATOR-SERVICE',
      );
      return { error: 'Operation not found' };
    }

    // Формируем итоговую структуру
    const periods = dbJob.monthResults.map((month) => ({
      period: month.period,
      initialBalance: Number(month.initialBalance),
      closingBalance: Number(month.closingBalance),
      transactions: month.transactions as unknown[],
    }));

    this.logger.log(
      `[getResult] Result fetched: operationId=${operationId}, periods=${periods.length}, status=${dbJob.status}`,
      'ORCESTRATOR-SERVICE',
    );

    return {
      companyName: dbJob.companyName || '',
      accountNumber: dbJob.accountNumber,
      periods,
      status: dbJob.status,
    };
  }

  private generateOperationId(dto: GenerateStatementDto): string {
    const crypto = require('crypto');
    const hash = crypto
      .createHash('sha256')
      .update(
        `${dto.companyId}_${dto.accountNumber}_${dto.startDate}_${dto.monthsCount}_${JSON.stringify(dto.parameters)}`,
      )
      .digest('hex')
      .slice(0, 16);
    const safeCompanyId = dto.companyId.replace(/:/g, '_').slice(0, 8);
    return `${safeCompanyId}-${hash}`;
  }
}
