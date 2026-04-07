import { Module } from '@nestjs/common';
import { DateCalculationService } from './date-calculation.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [DateCalculationService, PrismaService],
  exports: [DateCalculationService],
})
export class DateCalculationModule {}
