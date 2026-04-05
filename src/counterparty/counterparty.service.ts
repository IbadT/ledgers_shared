// src/modules/counterparty/counterparty.service.ts

import { Injectable } from '@nestjs/common';
import { AvailableCounterparty, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
// import type { PrismaService } from '../../shared/prisma/prisma.service';
// import type { Prisma } from '@prisma/client';

interface CounterpartySelection {
  name: string;
  category: string;
  type: 'client' | 'contractor';
  isGreen: boolean;
}

interface SelectionConfig {
  clients: {
    targetCount: number;
    repeatRate: number;
    variation: number;
  };
  contractors: {
    targetCount: number;
    repeatRate: number;
    variation: number;
  };
}

// Тип для создания истории использования
type CounterpartyUsageHistoryCreateInput =
  Prisma.CounterpartyUsageHistoryCreateInput;

@Injectable()
export class CounterpartyService {
  private readonly CLIENT_REPEAT_RATE = 0.6;
  private readonly CLIENT_VARIATION = 0.1;
  private readonly CONTRACTOR_REPEAT_RATE = 0.7;
  private readonly CONTRACTOR_VARIATION = 0.1;

  constructor(private readonly prisma: PrismaService) {}

  async selectForMonth(
    companyId: string,
    period: string,
    monthIndex: number,
    previousPeriod?: string,
  ): Promise<CounterpartySelection[]> {
    const config = await this.getSelectionConfig(companyId);
    const selected: CounterpartySelection[] = [];

    const clients = await this.selectByType(
      companyId,
      'client',
      config.clients,
      previousPeriod,
      monthIndex,
    );
    selected.push(...clients);

    const contractors = await this.selectByType(
      companyId,
      'contractor',
      config.contractors,
      previousPeriod,
      monthIndex,
    );
    selected.push(...contractors);

    await this.saveSelection(companyId, period, selected);

    return selected;
  }

  private async selectByType(
    companyId: string,
    type: 'client' | 'contractor',
    config: { targetCount: number; repeatRate: number; variation: number },
    previousPeriod: string | undefined,
    monthIndex: number,
  ): Promise<CounterpartySelection[]> {
    const result: CounterpartySelection[] = [];

    const greenCounterparties = await this.getGreenCategoryCounterparties(
      companyId,
      type,
    );
    result.push(...greenCounterparties);

    const remainingCount = Math.max(
      0,
      config.targetCount - greenCounterparties.length,
    );

    if (remainingCount === 0) {
      return result;
    }

    let toRepeatCount = 0;
    let previousCounterparties: CounterpartySelection[] = [];

    if (monthIndex > 0 && previousPeriod) {
      const rate =
        type === 'client'
          ? this.CLIENT_REPEAT_RATE
          : this.CONTRACTOR_REPEAT_RATE;
      const variation =
        type === 'client' ? this.CLIENT_VARIATION : this.CONTRACTOR_VARIATION;

      const adjustedRate = this.applyVariation(rate, variation);
      toRepeatCount = Math.round(remainingCount * adjustedRate);

      previousCounterparties = await this.getPreviousCounterparties(
        companyId,
        type,
        previousPeriod,
      );
    }

    const nonGreenPrevious = previousCounterparties.filter((p) => !p.isGreen);
    const toRepeat = this.shuffleArray(nonGreenPrevious).slice(
      0,
      toRepeatCount,
    );
    result.push(...toRepeat);

    const newCount = remainingCount - toRepeat.length;
    const usedNames = new Set(result.map((r) => r.name));

    const newCounterparties = await this.getNewCounterparties(
      companyId,
      type,
      newCount,
      usedNames,
    );
    result.push(...newCounterparties);

    return result;
  }

  private async getGreenCategoryCounterparties(
    companyId: string,
    type: 'client' | 'contractor',
  ): Promise<CounterpartySelection[]> {
    const greenAssignments = await this.prisma.greenCategoryAssignment.findMany(
      {
        where: {
          companyId,
          isActive: true,
        },
      },
    );

    const result: CounterpartySelection[] = [];

    for (const assignment of greenAssignments) {
      const counterpartyType = this.determineCounterpartyType(
        assignment.category,
      );

      if (counterpartyType === type) {
        result.push({
          name: assignment.counterpartyName,
          category: assignment.category,
          type,
          isGreen: true,
        });
      }
    }

    return result;
  }

  private async getPreviousCounterparties(
    companyId: string,
    type: 'client' | 'contractor',
    previousPeriod: string,
  ): Promise<CounterpartySelection[]> {
    const history = await this.prisma.counterpartyUsageHistory.findFirst({
      where: {
        companyId,
        type: type === 'client' ? 'CLIENT' : 'CONTRACTOR',
        period: previousPeriod,
      },
    });

    if (!history) {
      return [];
    }

    const counterparties: CounterpartySelection[] = [];
    const usedNames = history.usedNames as string[];
    const greenCategories = history.greenCategories as Array<{
      category: string;
      counterparty: string;
    }>;

    for (const name of usedNames) {
      const greenInfo = greenCategories.find((g) => g.counterparty === name);

      counterparties.push({
        name,
        category: greenInfo?.category || 'general',
        type,
        isGreen: !!greenInfo,
      });
    }

    return counterparties;
  }

  private async getNewCounterparties(
    companyId: string,
    type: 'client' | 'contractor',
    count: number,
    excludeNames: Set<string>,
  ): Promise<CounterpartySelection[]> {
    const availableFromDb = await this.prisma.availableCounterparty.findMany({
      where: {
        OR: [{ companyId }, { companyId: null }],
        type: type === 'client' ? 'CLIENT' : 'CONTRACTOR',
        isActive: true,
        name: {
          notIn: Array.from(excludeNames),
        },
      },
      orderBy: {
        priority: 'desc',
      },
      take: count * 3,
    });

    let available = availableFromDb;

    if (available.length < count) {
      const synthetic = this.generateSyntheticCounterparties(
        type,
        count - available.length,
        excludeNames,
      );
      available = [...available, ...synthetic];
    }

    const selected = this.weightedRandomSelection(available, count);

    return selected.map((c) => ({
      name: c.name,
      category: c.category,
      type,
      isGreen: false,
    }));
  }

  private async saveSelection(
    companyId: string,
    period: string,
    selected: CounterpartySelection[],
  ): Promise<void> {
    const clients = selected.filter((c) => c.type === 'client');
    const contractors = selected.filter((c) => c.type === 'contractor');

    const previousClients = await this.getAllPreviousCounterpartyNames(
      companyId,
      'client',
    );
    const previousContractors = await this.getAllPreviousCounterpartyNames(
      companyId,
      'contractor',
    );

    const clientHistoryData: CounterpartyUsageHistoryCreateInput = {
      companyId,
      type: 'CLIENT',
      period,
      usedNames: clients.map((c) => c.name),
      newNames: clients
        .filter((c) => !previousClients.has(c.name))
        .map((c) => c.name),
      greenCategories: clients
        .filter((c) => c.isGreen)
        .map((c) => ({ category: c.category, counterparty: c.name })),
    };

    const contractorHistoryData: CounterpartyUsageHistoryCreateInput = {
      companyId,
      type: 'CONTRACTOR',
      period,
      usedNames: contractors.map((c) => c.name),
      newNames: contractors
        .filter((c) => !previousContractors.has(c.name))
        .map((c) => c.name),
      greenCategories: contractors
        .filter((c) => c.isGreen)
        .map((c) => ({ category: c.category, counterparty: c.name })),
    };

    // Вариант 1: Последовательное выполнение (проще, без транзакции)
    await this.upsertCounterpartyState(companyId, 'CLIENT', clients);
    await this.upsertCounterpartyState(companyId, 'CONTRACTOR', contractors);
    await this.prisma.counterpartyUsageHistory.create({
      data: clientHistoryData,
    });
    await this.prisma.counterpartyUsageHistory.create({
      data: contractorHistoryData,
    });

    // ИЛИ: С транзакцией через массив промисов
    // await this.prisma.$transaction([
    //   this.prisma.counterpartyState.upsert({
    //     where: { companyId_type: { companyId, type: 'CLIENT' } },
    //     // ... данные
    //   }),
    //   this.prisma.counterpartyState.upsert({
    //     where: { companyId_type: { companyId, type: 'CONTRACTOR' } },
    //     // ... данные
    //   }),
    //   this.prisma.counterpartyUsageHistory.create({
    //     data: clientHistoryData,
    //   }),
    //   this.prisma.counterpartyUsageHistory.create({
    //     data: contractorHistoryData,
    //   }),
    // ]);
  }

  async establishGreenCategory(
    companyId: string,
    category: string,
    counterpartyName: string,
    period: string,
  ): Promise<void> {
    await this.prisma.greenCategoryAssignment.upsert({
      where: {
        companyId_category: {
          companyId,
          category,
        },
      },
      update: {
        counterpartyName,
        isActive: true,
      },
      create: {
        companyId,
        category,
        counterpartyName,
        establishedPeriod: period,
        isActive: true,
      },
    });
  }

  private async getSelectionConfig(
    companyId: string,
  ): Promise<SelectionConfig> {
    return {
      clients: {
        targetCount: 10,
        repeatRate: this.CLIENT_REPEAT_RATE,
        variation: this.CLIENT_VARIATION,
      },
      contractors: {
        targetCount: 15,
        repeatRate: this.CONTRACTOR_REPEAT_RATE,
        variation: this.CONTRACTOR_VARIATION,
      },
    };
  }

  private determineCounterpartyType(category: string): 'client' | 'contractor' {
    const clientCategories = ['MAJOR_CLIENT', 'REGULAR_CLIENT'];
    const contractorCategories = [
      'LEASE',
      'MOBILE',
      'UTILITIES',
      'INTERNET',
      'SUPPLIER',
    ];

    if (clientCategories.includes(category)) return 'client';
    if (contractorCategories.includes(category)) return 'contractor';

    return 'contractor';
  }

  private applyVariation(baseRate: number, variation: number): number {
    const min = baseRate - variation;
    const max = baseRate + variation;
    return min + Math.random() * (max - min);
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private weightedRandomSelection<T extends { priority: number }>(
    items: T[],
    count: number,
  ): T[] {
    if (items.length <= count) return items;

    const weights = items.map((i) => i.priority + 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const selected: T[] = [];
    const remainingItems = [...items];
    const remainingWeights = [...weights];

    while (selected.length < count && remainingItems.length > 0) {
      let random = Math.random() * totalWeight;
      let index = 0;

      while (random > 0 && index < remainingItems.length) {
        random -= remainingWeights[index];
        index++;
      }

      const actualIndex = Math.min(index - 1, remainingItems.length - 1);
      selected.push(remainingItems[actualIndex]);
      remainingItems.splice(actualIndex, 1);
      remainingWeights.splice(actualIndex, 1);
    }

    return selected;
  }

  private generateSyntheticCounterparties(
    type: 'client' | 'contractor',
    count: number,
    excludeNames: Set<string>,
  ): AvailableCounterparty[] {
    const result: AvailableCounterparty[] = [];
    let index = 1;

    while (result.length < count) {
      const name = `SYNTH_${type.toUpperCase()}_${index}`;
      if (!excludeNames.has(name)) {
        result.push({
          name,
          category: 'GENERAL',
          type: type === 'client' ? 'CLIENT' : 'CONTRACTOR',
          priority: 0,
          isActive: true,
          id: `synth-${Date.now()}-${index}`,
          companyId: null,
          createdAt: new Date(),
          defaultAmountMin: null,
          defaultAmountMax: null,
        } as AvailableCounterparty);
      }
      index++;
    }

    return result;
  }

  private async getAllPreviousCounterpartyNames(
    companyId: string,
    type: 'client' | 'contractor',
  ): Promise<Set<string>> {
    const state = await this.prisma.counterpartyState.findUnique({
      where: {
        companyId_type: {
          companyId,
          type: type === 'client' ? 'CLIENT' : 'CONTRACTOR',
        },
      },
    });

    if (!state) return new Set();

    const counterparties = state.counterparties as Array<{ name: string }>;
    return new Set(counterparties.map((c) => c.name));
  }

  private async upsertCounterpartyState(
    companyId: string,
    type: 'CLIENT' | 'CONTRACTOR',
    counterparties: CounterpartySelection[],
  ): Promise<void> {
    const existing = await this.prisma.counterpartyState.findUnique({
      where: { companyId_type: { companyId, type } },
    });

    const newCounterparties = counterparties.map((c) => ({
      name: c.name,
      category: c.category,
      isGreen: c.isGreen,
      usageCount: 1,
      lastUsedPeriod: new Date().toISOString().slice(0, 7),
    }));

    if (existing) {
      const existingList = existing.counterparties as Array<{
        name: string;
        category: string;
        isGreen: boolean;
        usageCount: number;
        lastUsedPeriod: string;
      }>;

      const updated = existingList.map((e) => {
        const match = counterparties.find((c) => c.name === e.name);
        if (match) {
          return {
            ...e,
            usageCount: e.usageCount + 1,
            lastUsedPeriod: new Date().toISOString().slice(0, 7),
          };
        }
        return e;
      });

      const newOnes = newCounterparties.filter(
        (n) => !existingList.some((e) => e.name === n.name),
      );

      await this.prisma.counterpartyState.update({
        where: { companyId_type: { companyId, type } },
        data: {
          counterparties: [...updated, ...newOnes],
          version: { increment: 1 },
        },
      });
    } else {
      await this.prisma.counterpartyState.create({
        data: {
          companyId,
          type,
          counterparties: newCounterparties,
          version: 1,
        },
      });
    }
  }
}
