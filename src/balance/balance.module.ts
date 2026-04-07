import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { BalanceController } from './balance.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [BalanceController],
  providers: [BalanceService, PrismaService],
  exports: [BalanceService],
})
export class BalanceModule {}
