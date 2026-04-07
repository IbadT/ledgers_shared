import { Module } from '@nestjs/common';
import { CounterpartyService } from './counterparty.service';
import { CounterpartyController } from './counterparty.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CounterpartyController],
  providers: [CounterpartyService, PrismaService],
  exports: [CounterpartyService, PrismaService],
})
export class CounterpartyModule {}
