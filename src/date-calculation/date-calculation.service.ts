import { Injectable } from '@nestjs/common';
import { DatePatternType, ShiftRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../shared/logger.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  async calculateDates(
    companyId: string,
    period: string,
    categories: DatePatternInput[],
  ): Promise<CalculatedDate[]> {
    const [year, month] = period.split('-').map(Number);
    this.logger.log(
      `[calculateDates] Calculating dates: companyId=${companyId}, period=${period}, categories=${categories.length}`,
      'DATE-CALC',
    );
    const result: CalculatedDate[] = [];

    for (const { category } of categories) {
      this.logger.debug(`[calculateDates] Processing category: ${category}`, 'DATE-CALC');
      const existingPattern = await this.getExistingPattern(
        companyId,
        category,
      );

      let calculatedDate: Date;
      let pattern: 'fixed' | 'floating';

      if (existingPattern) {
        this.logger.debug(`[calculateDates] Using existing pattern for ${category}`, 'DATE-CALC');
        calculatedDate = this.applyPattern(existingPattern, year, month);
        pattern = existingPattern.fixedDayOfMonth ? 'fixed' : 'floating';
      } else {
        this.logger.debug(`[calculateDates] Generating new pattern for ${category}`, 'DATE-CALC');
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

    this.logger.log(
      `[calculateDates] Completed: companyId=${companyId}, period=${period}, calculated=${result.length} dates`,
      'DATE-CALC',
    );
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
      return {
        patternType: 'LAST_DAY_OF_MONTH' as DatePatternType,
        dayOfWeek: 0,
        weekOfMonth: 0,
        // Используем 99 как маркер "последний день месяца" — applyPattern пересчитает динамически
        fixedDayOfMonth: 99,
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
      // Маркер 99 = "последний день месяца" — пересчитываем динамически
      if (pattern.fixedDayOfMonth === 99) {
        const lastDay = new Date(year, month, 0).getDate();
        return new Date(year, month - 1, lastDay);
      }
      // Фикс: не позволяем дню переполниться в следующий месяц
      // Например, 31 февраля → 28/29 февраля, не 3 марта
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      const day = Math.min(pattern.fixedDayOfMonth, lastDayOfMonth);
      return new Date(year, month - 1, day);
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
    this.logger.debug(
      `[getDateForCategory] Getting date: companyId=${companyId}, category=${category}, period=${period}`,
      'DATE-CALC',
    );
    const patterns = await this.calculateDates(companyId, period, [
      { category, type: 'contractor' },
    ]);
    const date = patterns[0]?.date || null;
    this.logger.debug(
      `[getDateForCategory] Result: date=${date}`,
      'DATE-CALC',
    );
    return date;
  }

  async hasPattern(companyId: string, category: string): Promise<boolean> {
    this.logger.debug(
      `[hasPattern] Checking pattern: companyId=${companyId}, category=${category}`,
      'DATE-CALC',
    );
    const count = await this.prisma.datePattern.count({
      where: {
        companyId,
        category,
      },
    });
    const hasPattern = count > 0;
    this.logger.debug(
      `[hasPattern] Result: ${hasPattern}`,
      'DATE-CALC',
    );
    return hasPattern;
  }

  async resetPattern(companyId: string, category: string): Promise<void> {
    this.logger.log(
      `[resetPattern] Resetting pattern: companyId=${companyId}, category=${category}`,
      'DATE-CALC',
    );
    await this.prisma.datePattern.deleteMany({
      where: {
        companyId,
        category,
      },
    });
    this.logger.log(
      `[resetPattern] Pattern reset: companyId=${companyId}, category=${category}`,
      'DATE-CALC',
    );
  }
}
