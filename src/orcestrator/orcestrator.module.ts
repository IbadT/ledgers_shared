import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { OrcestratorController } from './orcestrator.controller';
import { OrcestratorService } from './orcestrator.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from '../queue/queue.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    QueueModule,
    ClientsModule.registerAsync([
      {
        name: 'SHARED_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.getOrThrow<string>('RABBITMQ_URI')],
            queue: 'shared_queue',
            queueOptions: { durable: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [OrcestratorController],
  providers: [OrcestratorService],
})
export class OrcestratorModule {}
