// src/modules/balance/balance.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// import type { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getClosingBalance(
    companyId: string,
    accountNumber: string,
    period: string,
  ): Promise<number | null> {
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

    return result ? Number(result.closingBalance) : null;
  }

  async getLastKnownBalance(
    companyId: string,
    accountNumber: string,
  ): Promise<number | null> {
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

    return state ? Number(state.lastClosingBalance) : null;
  }

  async getInitialBalance(
    companyId: string,
    accountNumber: string,
    targetPeriod: string,
    previousPeriod?: string,
    userOverride?: number,
  ): Promise<number> {
    if (userOverride !== undefined) {
      return userOverride;
    }

    if (previousPeriod) {
      const previousClosing = await this.getClosingBalance(
        companyId,
        accountNumber,
        previousPeriod,
      );
      if (previousClosing !== null) {
        return previousClosing;
      }
    }

    const lastKnown = await this.getLastKnownBalance(companyId, accountNumber);
    return lastKnown ?? 0;
  }

  async saveBalance(
    companyId: string,
    accountNumber: string,
    period: string,
    closingBalance: number,
  ): Promise<void> {
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
  }
}
