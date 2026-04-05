// src/modules/date-calculation/date-calculation.service.ts

import { Injectable } from '@nestjs/common';
import { DatePatternType, ShiftRule } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
// import type { PrismaService } from '../../shared/prisma/prisma.service';
// import { DatePatternType, ShiftRule } from '@prisma/client';

interface DatePatternInput {
  category: string;
  type: 'client' | 'contractor';
}

interface CalculatedDate {
  category: string;
  date: Date;
  pattern: 'fixed' | 'floating';
  originalDay?: number;
  shifted?: boolean;
}

interface DatePattern {
  dayOfWeek: number;
  weekOfMonth: number;
  fixedDayOfMonth?: number;
  shiftRule: ShiftRule;
}

@Injectable()
export class DateCalculationService {
  private readonly US_HOLIDAYS = ['01-01', '07-04', '12-25'];

  constructor(private readonly prisma: PrismaService) {}

  async calculateDates(
    companyId: string,
    period: string,
    categories: DatePatternInput[],
  ): Promise<CalculatedDate[]> {
    const [year, month] = period.split('-').map(Number);
    const result: CalculatedDate[] = [];

    for (const { category } of categories) {
      const existingPattern = await this.getExistingPattern(
        companyId,
        category,
      );

      let calculatedDate: Date;
      let pattern: 'fixed' | 'floating';

      if (existingPattern) {
        calculatedDate = this.applyPattern(existingPattern, year, month);
        pattern = existingPattern.fixedDayOfMonth ? 'fixed' : 'floating';
      } else {
        const newPattern = this.generateRandomPattern(category, year, month);
        calculatedDate = this.applyPattern(newPattern, year, month);
        pattern = newPattern.fixedDayOfMonth ? 'fixed' : 'floating';

        await this.savePattern(companyId, category, newPattern, period);
      }

      const finalDate = this.shiftToWeekdayIfNeeded(
        calculatedDate,
        existingPattern?.shiftRule || 'NEXT_WEEKDAY',
      );

      result.push({
        category,
        date: finalDate,
        pattern,
        originalDay: calculatedDate.getDate(),
        shifted: finalDate.getTime() !== calculatedDate.getTime(),
      });
    }

    return result;
  }

  private async getExistingPattern(
    companyId: string,
    category: string,
  ): Promise<DatePattern | null> {
    const pattern = await this.prisma.datePattern.findUnique({
      where: {
        companyId_category: {
          companyId,
          category,
        },
      },
    });

    if (!pattern) return null;

    // Проверяем обязательные поля
    if (pattern.dayOfWeek === null || pattern.weekOfMonth === null) {
      return null;
    }

    return {
      dayOfWeek: pattern.dayOfWeek,
      weekOfMonth: pattern.weekOfMonth,
      fixedDayOfMonth: pattern.fixedDayOfMonth ?? undefined,
      shiftRule: pattern.shiftRule,
    };
  }

  private generateRandomPattern(
    category: string,
    year: number,
    month: number,
  ): DatePattern & { patternType: DatePatternType } {
    const fixedDayCategories = ['TAX', 'INSURANCE', 'LEASE'];
    const lastDayCategories = ['PAYROLL_END', 'RENT'];

    if (fixedDayCategories.includes(category)) {
      return {
        patternType: 'FIXED_DAY_OF_MONTH' as DatePatternType,
        dayOfWeek: 0,
        weekOfMonth: 0,
        fixedDayOfMonth: 15,
        shiftRule: 'NEXT_WEEKDAY',
      };
    }

    if (lastDayCategories.includes(category)) {
      const lastDay = new Date(year, month, 0).getDate();
      return {
        patternType: 'FIXED_DAY_OF_MONTH' as DatePatternType,
        dayOfWeek: 0,
        weekOfMonth: 0,
        fixedDayOfMonth: lastDay,
        shiftRule: 'PREV_WEEKDAY',
      };
    }

    const dayOfWeek = Math.floor(Math.random() * 5) + 1;
    const weekOfMonth = Math.floor(Math.random() * 4) + 1;

    return {
      patternType: 'FLOATING_NTH_WEEKDAY' as DatePatternType,
      dayOfWeek,
      weekOfMonth,
      shiftRule: 'NO_SHIFT',
    };
  }

  private applyPattern(
    pattern: DatePattern,
    year: number,
    month: number,
  ): Date {
    if (pattern.fixedDayOfMonth) {
      return new Date(year, month - 1, pattern.fixedDayOfMonth);
    }

    return this.getNthWeekdayOfMonth(
      year,
      month - 1,
      pattern.dayOfWeek,
      pattern.weekOfMonth,
    );
  }

  getNthWeekdayOfMonth(
    year: number,
    month: number,
    dayOfWeek: number,
    n: number,
  ): Date {
    const firstDayOfMonth = new Date(year, month, 1);
    const firstDayWeekday = firstDayOfMonth.getDay();

    let offset = dayOfWeek - firstDayWeekday;
    if (offset < 0) offset += 7;

    const day = 1 + offset + (n - 1) * 7;

    return new Date(year, month, day);
  }

  private shiftToWeekdayIfNeeded(date: Date, rule: ShiftRule): Date {
    if (rule === 'NO_SHIFT') return date;

    let result = new Date(date);
    const maxIterations = 7;

    for (let i = 0; i < maxIterations; i++) {
      const dayOfWeek = result.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = this.isHoliday(result);

      if (!isWeekend && !isHoliday) break;

      if (rule === 'NEXT_WEEKDAY') {
        result.setDate(result.getDate() + 1);
      } else {
        result.setDate(result.getDate() - 1);
      }
    }

    return result;
  }

  private isHoliday(date: Date): boolean {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${month}-${day}`;

    return this.US_HOLIDAYS.includes(dateStr);
  }

  private async savePattern(
    companyId: string,
    category: string,
    pattern: DatePattern & { patternType: DatePatternType },
    period: string,
  ): Promise<void> {
    await this.prisma.datePattern.upsert({
      where: {
        companyId_category: {
          companyId,
          category,
        },
      },
      update: {
        dayOfWeek: pattern.dayOfWeek,
        weekOfMonth: pattern.weekOfMonth,
        fixedDayOfMonth: pattern.fixedDayOfMonth,
        shiftRule: pattern.shiftRule,
      },
      create: {
        companyId,
        category,
        patternType: pattern.patternType,
        dayOfWeek: pattern.dayOfWeek,
        weekOfMonth: pattern.weekOfMonth,
        fixedDayOfMonth: pattern.fixedDayOfMonth,
        shiftRule: pattern.shiftRule,
        establishedPeriod: period,
      },
    });
  }

  async getDateForCategory(
    companyId: string,
    category: string,
    period: string,
  ): Promise<Date | null> {
    const patterns = await this.calculateDates(companyId, period, [
      { category, type: 'contractor' },
    ]);
    return patterns[0]?.date || null;
  }

  async hasPattern(companyId: string, category: string): Promise<boolean> {
    const count = await this.prisma.datePattern.count({
      where: {
        companyId,
        category,
      },
    });
    return count > 0;
  }

  async resetPattern(companyId: string, category: string): Promise<void> {
    await this.prisma.datePattern.deleteMany({
      where: {
        companyId,
        category,
      },
    });
  }
}
