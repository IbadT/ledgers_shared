import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrcestratorModule } from './orcestrator/orcestrator.module';
import { BalanceModule } from './balance/balance.module';
import { QueueModule } from './queue/queue.module';
import { CounterpartyModule } from './counterparty/counterparty.module';
import { DateCalculationModule } from './date-calculation/date-calculation.module';
import { SharedModule } from './shared/shared.module';
import redisConfig from './config/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [redisConfig],
      isGlobal: true,
    }),
    SharedModule,
    OrcestratorModule,
    BalanceModule,
    QueueModule,
    CounterpartyModule,
    DateCalculationModule,
  ],
})
export class AppModule {}
