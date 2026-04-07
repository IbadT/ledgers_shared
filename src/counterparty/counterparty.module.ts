import { Module } from '@nestjs/common';
import { CounterpartyService } from './counterparty.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [CounterpartyService, PrismaService],
  exports: [CounterpartyService, PrismaService],
})
export class CounterpartyModule {}
