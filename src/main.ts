import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [
        // `amqp://${configService.get('RABBITMQ_USER')}:${configService.get('RABBITMQ_PASS')}@${configService.get('RABBITMQ_HOST')}:${configService.get('RABBITMQ_PORT')}`,
        configService.getOrThrow<string>('RABBITMQ_URI'),
      ],
      exchange: 'shared.exchange',
      exchangeType: 'topic',
      queue: 'orchestrator_queue',
      queueOptions: {
        durable: true,
      },
      noAck: false, // ручное подтверждение
    },
  });

  const config = new DocumentBuilder()
    .setTitle('Shared API')
    .setDescription('Bank statement shared service')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get('PORT');

  await app.startAllMicroservices();
  await app.listen(port ?? 4000);

  console.log(`
╔═════════════════════════════════════════════════════════════╗
║     🚀 SHARED MICROSERVICE STARTED                          ║
╠═════════════════════════════════════════════════════════════╣
║  📡 HTTP:       http://localhost:${port}                    ║
║  📚 Swagger:    http://localhost:${port}/api/docs           ║
║  🐰 RabbitMQ:   shared.exchange / orchestrator_queue        ║
║  ✅ Status:     Running                                     ║
╚════════════════════════════════════════════════════════════╝
`);
}
void bootstrap();
