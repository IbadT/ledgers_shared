import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [BalanceService, PrismaService],
  exports: [BalanceService],
})
export class BalanceModule {}
