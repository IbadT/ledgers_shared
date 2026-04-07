// src/modules/balance/balance.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../shared/logger.service';

@Injectable()
export class BalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  async getClosingBalance(
    companyId: string,
    accountNumber: string,
    period: string,
  ): Promise<number | null> {
    this.logger.debug(
      `[getClosingBalance] Fetching: companyId=${companyId}, accountNumber=${accountNumber}, period=${period}`,
      'BALANCE',
    );
    const result = await this.prisma.monthResult.findFirst({
      where: {
        job: {
          companyId,
          accountNumber,
        },
        period,
      },
      select: {
        closingBalance: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const balance = result ? Number(result.closingBalance) : null;
    this.logger.debug(
      `[getClosingBalance] Result: companyId=${companyId}, period=${period}, balance=${balance}`,
      'BALANCE',
    );
    return balance;
  }

  async getLastKnownBalance(
    companyId: string,
    accountNumber: string,
  ): Promise<number | null> {
    this.logger.debug(
      `[getLastKnownBalance] Fetching: companyId=${companyId}, accountNumber=${accountNumber}`,
      'BALANCE',
    );
    const state = await this.prisma.accountBalanceState.findUnique({
      where: {
        companyId_accountNumber: {
          companyId,
          accountNumber,
        },
      },
      select: {
        lastClosingBalance: true,
      },
    });

    const balance = state ? Number(state.lastClosingBalance) : null;
    this.logger.debug(
      `[getLastKnownBalance] Result: companyId=${companyId}, balance=${balance}`,
      'BALANCE',
    );
    return balance;
  }

  async getInitialBalance(
    companyId: string,
    accountNumber: string,
    targetPeriod: string,
    previousPeriod?: string,
    userOverride?: number,
  ): Promise<number> {
    this.logger.log(
      `[getInitialBalance] Calculating: companyId=${companyId}, targetPeriod=${targetPeriod}, previousPeriod=${previousPeriod}`,
      'BALANCE',
    );

    if (userOverride !== undefined) {
      this.logger.log(
        `[getInitialBalance] Using user override: ${userOverride}`,
        'BALANCE',
      );
      return userOverride;
    }

    if (previousPeriod) {
      const previousClosing = await this.getClosingBalance(
        companyId,
        accountNumber,
        previousPeriod,
      );
      if (previousClosing !== null) {
        this.logger.log(
          `[getInitialBalance] Using previous closing balance: ${previousClosing}`,
          'BALANCE',
        );
        return previousClosing;
      }
    }

    const lastKnown = await this.getLastKnownBalance(companyId, accountNumber);
    const result = lastKnown ?? 0;
    this.logger.log(
      `[getInitialBalance] Using last known balance: ${result}`,
      'BALANCE',
    );
    return result;
  }

  async saveBalance(
    companyId: string,
    accountNumber: string,
    period: string,
    closingBalance: number,
  ): Promise<void> {
    this.logger.log(
      `[saveBalance] Saving: companyId=${companyId}, accountNumber=${accountNumber}, period=${period}, closingBalance=${closingBalance}`,
      'BALANCE',
    );
    await this.prisma.accountBalanceState.upsert({
      where: {
        companyId_accountNumber: {
          companyId,
          accountNumber,
        },
      },
      update: {
        lastPeriod: period,
        lastClosingBalance: closingBalance,
      },
      create: {
        companyId,
        accountNumber,
        lastPeriod: period,
        lastClosingBalance: closingBalance,
      },
    });
    this.logger.log(
      `[saveBalance] Saved successfully: companyId=${companyId}, period=${period}`,
      'BALANCE',
    );
  }
}
