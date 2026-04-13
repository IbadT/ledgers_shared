import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, QueueEvents } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { QueueService, GenerateMonthJobData } from '../queue.service';
import { CounterpartyService } from '../../counterparty/counterparty.service';
import { DateCalculationService } from '../../date-calculation/date-calculation.service';
import { BalanceService } from '../../balance/balance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogger } from '../../shared/logger.service';

interface MonthResult {
  period: string;
  initialBalance: number;
  closingBalance: number;
  transactions: unknown[];
  usedClients: string[];
  usedContractors: string[];
}

interface CounterpartyItem {
  name: string;
  category: string;
  type: 'client' | 'contractor';
  isGreen: boolean;
}

// Интерфейс для хранения промежуточных результатов между retry-попытками (идемпотентность)
interface RetryState {
  step1_initialBalance?: number;
  step2_counterparties?: CounterpartyItem[];
  step3_datePatterns?: any[];
  step3_uniqueCategories?: any[];
  step4_forwardInfo?: any[];
  step5_matematikaResult?: { finalBalance: number; transactions: unknown[] };
  step6_maskaResult?: unknown[];
}

@Processor('statement-generation', {
  concurrency: 1,
  limiter: {
    max: 10,
    duration: 1000,
  },
})
@Injectable()
export class MonthGenerationProcessor extends WorkerHost {
  private readonly matematikaEvents: QueueEvents;
  private readonly maskaEvents: QueueEvents;

  constructor(
    private readonly queueService: QueueService,
    private readonly counterpartyService: CounterpartyService,
    private readonly balanceService: BalanceService,
    private readonly dateCalcService: DateCalculationService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {
    super();

    this.matematikaEvents = new QueueEvents('matematika-calls', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
      },
    });

    this.maskaEvents = new QueueEvents('maska-calls', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
      },
    });
  }

  async process(job: Job<GenerateMonthJobData>): Promise<MonthResult> {
    const {
      operationId,
      companyId,
      companyName,
      accountNumber,
      period,
      monthIndex,
      totalMonths,
      parameters,
      previousPeriod,
    } = job.data;

    // ИДЕМПОТЕНТНОСТЬ RETRY: Получаем или инициализируем состояние retry
    const extendedJobData = job.data as GenerateMonthJobData & { _retryState?: RetryState };
    const retryState: RetryState = extendedJobData._retryState || {};

    if (job.attemptsMade > 0) {
      this.logger.log(
        `[process] Retry attempt ${job.attemptsMade} for job ${job.id}, period=${period}`,
        'MONTH-PROCESSOR',
      );
    }

    // 1. Определяем начальный баланс
    await job.updateProgress({
      step: 1,
      total: 6,
      phase: 'determining-balance',
    });

    let initialBalance: number;
    if (retryState.step1_initialBalance !== undefined) {
      initialBalance = retryState.step1_initialBalance;
      this.logger.debug(`[process] Using cached initialBalance: ${initialBalance}`, 'MONTH-PROCESSOR');
    } else {
      initialBalance = await this.balanceService.getInitialBalance(
        companyId,
        accountNumber,
        period,
        previousPeriod,
        parameters.userOverrides?.initialBalance,
      );
      retryState.step1_initialBalance = initialBalance;
      await job.updateData({ ...job.data, _retryState: retryState });
    }

    // 2. Выбор контрагентов с правилами 60%/70%
    await job.updateProgress({
      step: 2,
      total: 6,
      phase: 'selecting-counterparties',
    });

    let counterparties: CounterpartyItem[];
    if (retryState.step2_counterparties) {
      counterparties = retryState.step2_counterparties;
      this.logger.debug(
        `[process] Using cached counterparties: ${counterparties.length} items`,
        'MONTH-PROCESSOR',
      );
    } else {
      counterparties = await this.counterpartyService.selectForMonth(
        companyId,
        period,
        monthIndex,
        previousPeriod,
      );
      retryState.step2_counterparties = counterparties;
      await job.updateData({ ...job.data, _retryState: retryState });
    }

    // 3. Расчет дат с паттернами
    await job.updateProgress({ step: 3, total: 6, phase: 'calculating-dates' });

    let uniqueCategories: any[];
    let datePatterns: any[];
    if (retryState.step3_datePatterns && retryState.step3_uniqueCategories) {
      uniqueCategories = retryState.step3_uniqueCategories;
      datePatterns = retryState.step3_datePatterns;
      this.logger.debug(`[process] Using cached datePatterns`, 'MONTH-PROCESSOR');
    } else {
      // Дедупликация категорий — одна дата на категорию, независимо от количества контрагентов
      uniqueCategories = Array.from(
        new Map(
          counterparties.map((c) => [c.category, { category: c.category, type: c.type }]),
        ).values(),
      );

      datePatterns = await this.dateCalcService.calculateDates(
        companyId,
        period,
        uniqueCategories,
      );
      retryState.step3_uniqueCategories = uniqueCategories;
      retryState.step3_datePatterns = datePatterns;
      await job.updateData({ ...job.data, _retryState: retryState });
    }

    // 4. Подготовка forward info
    let forwardInfo: any[] | undefined;
    if (retryState.step4_forwardInfo !== undefined) {
      forwardInfo = retryState.step4_forwardInfo;
    } else {
      forwardInfo =
        monthIndex > 0
          ? await this.getForwardingInfo(companyId, previousPeriod!)
          : undefined;
      retryState.step4_forwardInfo = forwardInfo;
      await job.updateData({ ...job.data, _retryState: retryState });
    }

    // 5. Вызов Matematika
    await job.updateProgress({
      step: 4,
      total: 6,
      phase: 'calling-matematika',
    });

    let matematikaResult: { finalBalance: number; transactions: unknown[] };
    if (retryState.step5_matematikaResult) {
      matematikaResult = retryState.step5_matematikaResult;
      this.logger.debug(`[process] Using cached matematikaResult`, 'MONTH-PROCESSOR');
    } else {
      matematikaResult = await this.callMatematika(
        operationId,
        period,
        initialBalance,
        counterparties,
        datePatterns,
        forwardInfo,
        parameters,
      );
      retryState.step5_matematikaResult = matematikaResult;
      await job.updateData({ ...job.data, _retryState: retryState });
    }

    // 6. Вызов Maska
    await job.updateProgress({ step: 5, total: 6, phase: 'calling-maska' });

    let finalTransactions: unknown[];
    if (retryState.step6_maskaResult) {
      finalTransactions = retryState.step6_maskaResult;
      this.logger.debug(`[process] Using cached maskaResult`, 'MONTH-PROCESSOR');
    } else {
      finalTransactions = await this.callMaska(
        operationId,
        period,
        matematikaResult.transactions,
        {
          companyName,
          accountNumber,
        },
      );
      retryState.step6_maskaResult = finalTransactions;
      await job.updateData({ ...job.data, _retryState: retryState });
    }

    // 7. Сохранение результата
    await job.updateProgress({ step: 6, total: 6, phase: 'saving-results' });

    const result: MonthResult = {
      period,
      initialBalance,
      closingBalance: matematikaResult.finalBalance,
      transactions: finalTransactions,
      usedClients: counterparties
        .filter((c) => c.type === 'client')
        .map((c) => c.name),
      usedContractors: counterparties
        .filter((c) => c.type === 'contractor')
        .map((c) => c.name),
    };

    await this.saveResult(operationId, result);
    await this.balanceService.saveBalance(
      companyId,
      accountNumber,
      period,
      result.closingBalance,
    );

    // ИДЕМПОТЕНТНОСТЬ: Сохраняем контрагентов ТОЛЬКО после успешного завершения всех шагов.
    // При retry это сохранение будет пропущено, т.к. записи уже существуют.
    await this.counterpartyService.saveCounterpartySelection(
      companyId,
      period,
      counterparties,
    );

    // ФИКС: Последовательная обработка месяцев — добавляем следующий месяц по завершении текущего
    const jobData = job.data as GenerateMonthJobData & { _startDate?: string; _parameters?: any[] };
    if (jobData._startDate && jobData._parameters) {
      await this.queueService.addNextMonthJob(
        operationId,
        companyId,
        companyName,
        accountNumber,
        new Date(jobData._startDate),
        monthIndex,
        totalMonths,
        jobData._parameters,
      );
    }

    // Очищаем retryState после успешного завершения
    await job.updateData({ ...job.data, _retryState: undefined });

    return result;
  }

  private async callMatematika(
    operationId: string,
    period: string,
    initialBalance: number,
    counterparties: CounterpartyItem[],
    datePatterns: any[],
    forwardInfo: any[] | undefined,
    parameters: any,
  ): Promise<{ finalBalance: number; transactions: unknown[] }> {
    const matematikaJob = await this.queueService.addMatematikaCall({
      operationId,
      period,
      context: {
        initialBalance,
        counterparties,
        datePatterns,
        parameters,
        ...(forwardInfo && { forwardInfo }),
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Matematika call timeout for ${period}`));
      }, 30000);

      const handler = async (args: { jobId: string; returnvalue: any }) => {
        if (args.jobId === matematikaJob.id) {
          clearTimeout(timeout);
          this.matematikaEvents.off('completed', handler);
          this.matematikaEvents.off('failed', failHandler);
          resolve(args.returnvalue);
        }
      };

      const failHandler = async (args: {
        jobId: string;
        failedReason: string;
      }) => {
        if (args.jobId === matematikaJob.id) {
          clearTimeout(timeout);
          this.matematikaEvents.off('completed', handler);
          this.matematikaEvents.off('failed', failHandler);
          reject(new Error(`Matematika job failed: ${args.failedReason}`));
        }
      };

      this.matematikaEvents.on('completed', handler);
      this.matematikaEvents.on('failed', failHandler);
    });
  }

  private async callMaska(
    operationId: string,
    period: string,
    transactions: unknown[],
    metadata: Record<string, unknown>,
  ): Promise<unknown[]> {
    const maskaJob = await this.queueService.addMaskaCall({
      operationId,
      period,
      transactions,
      metadata,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Maska call timeout for ${period}`));
      }, 30000);

      const handler = async (args: { jobId: string; returnvalue: any }) => {
        if (args.jobId === maskaJob.id) {
          clearTimeout(timeout);
          this.maskaEvents.off('completed', handler);
          this.maskaEvents.off('failed', failHandler);
          resolve(args.returnvalue);
        }
      };

      const failHandler = async (args: {
        jobId: string;
        failedReason: string;
      }) => {
        if (args.jobId === maskaJob.id) {
          clearTimeout(timeout);
          this.maskaEvents.off('completed', handler);
          this.maskaEvents.off('failed', failHandler);
          reject(new Error(`Maska job failed: ${args.failedReason}`));
        }
      };

      this.maskaEvents.on('completed', handler);
      this.maskaEvents.on('failed', failHandler);
    });
  }

  private async getForwardingInfo(
    companyId: string,
    previousPeriod: string,
  ): Promise<
    Array<{
      category: string;
      baseAmount: number;
      variationPercent: number;
      isFixedExact: boolean;
    }>
  > {
    const states = await this.prisma.fixedAmountState.findMany({
      where: {
        companyId,
        // Берем только те, что были установлены до или в previousPeriod
        establishedPeriod: {
          lte: previousPeriod,
        },
      },
      select: {
        category: true,
        baseAmount: true,
        variationPercent: true,
        isFixedExact: true,
      },
      // Берем самые свежие по категории
      orderBy: {
        establishedPeriod: 'desc',
      },
    });

    // Конвертируем Decimal в number и убираем дубликаты по категории
    const seenCategories = new Set<string>();
    const result: Array<{
      category: string;
      baseAmount: number;
      variationPercent: number;
      isFixedExact: boolean;
    }> = [];

    for (const state of states) {
      if (seenCategories.has(state.category)) continue;
      seenCategories.add(state.category);

      result.push({
        category: state.category,
        baseAmount: Number(state.baseAmount),
        variationPercent: Number(state.variationPercent),
        isFixedExact: state.isFixedExact,
      });
    }

    return result;
  }

  private async saveResult(
    operationId: string,
    result: MonthResult,
  ): Promise<void> {
    await this.prisma.monthResult.create({
      data: {
        job: { connect: { operationId } },
        period: result.period,
        periodStart: new Date(result.period + '-01'),
        periodEnd: new Date(
          new Date(result.period + '-01').getFullYear(),
          new Date(result.period + '-01').getMonth() + 1,
          0,
        ),
        initialBalance: result.initialBalance,
        closingBalance: result.closingBalance,
        transactions: result.transactions as any,
        usedClients: result.usedClients,
        usedContractors: result.usedContractors,
      },
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<GenerateMonthJobData>): void {
    console.log(`[${job.data.operationId}] Month ${job.data.period} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<GenerateMonthJobData>, error: Error): void {
    console.error(
      `[${job.data.operationId}] Month ${job.data.period} failed:`,
      error.message,
    );
  }
}
