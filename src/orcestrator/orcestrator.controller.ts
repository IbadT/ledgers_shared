import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ClientProxy, Ctx, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { OrcestratorService } from './orcestrator.service';
import { GenerateStatementDto } from './dto/generate-statemtnt.dto';
import { AppLogger } from '../shared/logger.service';

@Controller('orcestrator')
export class OrcestratorController {
  constructor(
    @Inject('SHARED_SERVICE') private readonly sharedClient: ClientProxy,
    private readonly orcestratorService: OrcestratorService,
    private readonly logger: AppLogger,
  ) {}

  // HTTP endpoints
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(@Body() dto: GenerateStatementDto): Promise<{
    operationId: string;
    status: string;
    message: string;
  }> {
    this.logger.log(
      `Generate request: company=${dto.companyId}, months=${dto.monthsCount}`,
      'ORCESTRATOR',
    );
    const result = await this.orcestratorService.generate(dto);
    this.logger.log(
      `Generate accepted: operationId=${result.operationId}, status=${result.status}`,
      'ORCESTRATOR',
    );
    return result;
  }

  @Get('status/:operationId')
  async getStatus(@Param('operationId') operationId: string) {
    this.logger.log(`Get status request: operationId=${operationId}`, 'ORCESTRATOR');
    const result = await this.orcestratorService.getStatus(operationId);
    this.logger.log(
      `Status response: operationId=${operationId}, status=${result.status}`,
      'ORCESTRATOR',
    );
    return result;
  }

  @Post('cancel/:operationId')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('operationId') operationId: string,
  ): Promise<{ removed: number; errors: string[] }> {
    this.logger.log(`Cancel request: operationId=${operationId}`, 'ORCESTRATOR');
    const result = await this.orcestratorService.cancel(operationId);
    this.logger.log(
      `Cancel completed: operationId=${operationId}, removed=${result.removed}`,
      'ORCESTRATOR',
    );
    return result;
  }

  @Post('retry/:operationId')
  @HttpCode(HttpStatus.OK)
  async retry(
    @Param('operationId') operationId: string,
  ): Promise<{ retried: number }> {
    this.logger.log(`Retry request: operationId=${operationId}`, 'ORCESTRATOR');
    const result = await this.orcestratorService.retry(operationId);
    this.logger.log(
      `Retry completed: operationId=${operationId}, retried=${result.retried}`,
      'ORCESTRATOR',
    );
    return result;
  }

  @Get('metrics/:queueName')
  async getMetrics(
    @Param('queueName')
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
  ) {
    this.logger.log(`Get metrics request: queue=${queueName}`, 'ORCESTRATOR');
    const result = await this.orcestratorService.getMetrics(queueName);
    this.logger.log(
      `Metrics response: queue=${queueName}, waiting=${result.waiting}, active=${result.active}`,
      'ORCESTRATOR',
    );
    return result;
  }

  @Get('result/:operationId')
  async getResult(@Param('operationId') operationId: string) {
    this.logger.log(`Get result request: operationId=${operationId}`, 'ORCESTRATOR');
    const result = await this.orcestratorService.getResult(operationId);
    this.logger.log(
      `Result response: operationId=${operationId}, hasData=${!!result}`,
      'ORCESTRATOR',
    );
    return result;
  }

  // RabbitMQ message handlers
  @MessagePattern('statement.generate')
  async handleStatementGenerate(
    @Payload() dto: GenerateStatementDto,
    @Ctx() context: RmqContext,
  ) {
    this.logger.log(
      `RabbitMQ message received: statement.generate, company=${dto.companyId}`,
      'ORCESTRATOR',
    );
    const result = await this.orcestratorService.generate(dto);
    this.logger.log(
      `RabbitMQ message processed: operationId=${result.operationId}`,
      'ORCESTRATOR',
    );
    const channel = context.getChannelRef();
    const message = context.getMessage();
    channel.ack(message);
    return result;
  }
}
