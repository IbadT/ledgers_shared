import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { OrcestratorModule } from './orcestrator/orcestrator.module';
import { MatematikaClientModule } from './matematika-client/matematika-client.module';
import { MaskaClientModule } from './maska-client/maska-client.module';
import { BalanceModule } from './balance/balance.module';
import { QueueModule } from './queue/queue.module';
import { CounterpartyModule } from './counterparty/counterparty.module';
import { DateCalculationModule } from './date-calculation/date-calculation.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    OrcestratorModule,
    MatematikaClientModule,
    MaskaClientModule,
    BalanceModule,
    QueueModule,
    CounterpartyModule,
    DateCalculationModule,
    // ClientsModule.register([
    //   {
    //     name: 'SHARED_SERVICE',
    //     transport: Transport.RMQ,
    //     options: {
    //       urls: [
    //         `amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PASS}@${process.env.RABBITMQ_HOST}:${process.env.RABBITMQ_PORT}`,
    //       ],
    //       queue: 'orchestrator_queue',
    //       queueOptions: {
    //         durable: true,
    //       },
    //     },
    //   },
    // ]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
