import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { QueueService } from './queue.service';
import { RedisConfig } from '../config/redis.config';
import { MaskaCallProcessor } from './processor/maska-call.processor';
import { MatematikaCallProcessor } from './processor/matematika-call.processor';
import { MonthGenerationProcessor } from './processor/month-generation.processor';
import { PrismaService } from '../prisma/prisma.service';
import { CounterpartyModule } from '../counterparty/counterparty.module';
import { BalanceModule } from '../balance/balance.module';
import { DateCalculationModule } from '../date-calculation/date-calculation.module';

@Global()
@Module({
  imports: [
    CounterpartyModule,
    BalanceModule,
    DateCalculationModule,
    HttpModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.getOrThrow<RedisConfig>('redis');

        return {
          connection: {
            host: config.host,
            port: config.port,
            password: config.password,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: {
              count: 100,
              age: 24 * 3600,
            },
            removeOnFail: {
              count: 50,
              age: 7 * 24 * 3600,
            },
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: 'statement-generation' },
      { name: 'matematika-calls' },
      { name: 'maska-calls' },
    ),
  ],
  providers: [
    QueueService,
    MonthGenerationProcessor,
    MatematikaCallProcessor,
    MaskaCallProcessor,
    PrismaService
  ],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
