import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { OrcestratorModule } from './orcestrator/orcestrator.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    OrcestratorModule,
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
