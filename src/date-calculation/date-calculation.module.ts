import { Module } from '@nestjs/common';
import { DateCalculationService } from './date-calculation.service';
import { DateCalculationController } from './date-calculation.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [DateCalculationController],
  providers: [DateCalculationService, PrismaService],
  exports: [DateCalculationService],
})
export class DateCalculationModule {}
