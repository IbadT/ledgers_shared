import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from './shared/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);

  logger.log('Starting Shared Microservice...', 'APP');
  logger.log(`RabbitMQ URI: ${configService.get('RABBITMQ_URI')}`, 'APP');

  app.setGlobalPrefix('api');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [
        configService.getOrThrow<string>('RABBITMQ_URI'),
      ],
      exchange: 'shared.exchange',
      exchangeType: 'topic',
      queue: 'shared_queue',
      queueOptions: {
        durable: true,
      },
      noAck: false,
    },
  });

  const config = new DocumentBuilder()
    .setTitle('Shared API')
    .setDescription('Bank statement shared service')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.getOrThrow<number>('PORT');

  await app.startAllMicroservices();
  logger.log('RabbitMQ microservice started', 'APP');
  
  await app.listen(port);
  logger.log(`HTTP server listening on port ${port}`, 'APP');

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
