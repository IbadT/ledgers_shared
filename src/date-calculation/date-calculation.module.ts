import { Module } from '@nestjs/common';
import { DateCalculationService } from './date-calculation.service';
import { DateCalculationController } from './date-calculation.controller';

@Module({
  controllers: [DateCalculationController],
  providers: [DateCalculationService],
})
export class DateCalculationModule {}
