import {
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { GenerateStatementDto } from './dto/generate-statemtnt.dto';

@Injectable()
export class OrcestratorService {
  constructor(
    private readonly queueService: QueueService,
    // private readonly jobManager: JobManagerService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(@Body() dto: GenerateStatementDto): Promise<{
    operationId: string;
    status: string;
    message: string;
  }> {
    const operationId = this.generateOperationId(dto);

    // Создаем Flow генерации
    await this.queueService.createStatementGenerationFlow(
      operationId,
      dto.companyId,
      dto.companyName,
      dto.accountNumber,
      new Date(dto.startDate),
      dto.monthsCount,
      dto.parameters,
    );

    return {
      operationId,
      status: 'accepted',
      message: `Generation started for ${dto.monthsCount} months`,
    };
  }

  @Get('status/:operationId')
  async getStatus(@Param('operationId', ParseUUIDPipe) operationId: string) {
    return this.queueService.getOperationStatus(operationId);
  }

  @Post('cancel/:operationId')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ): Promise<{ removed: number; errors: string[] }> {
    return this.queueService.cancelOperation(operationId);
  }

  @Post('retry/:operationId')
  @HttpCode(HttpStatus.OK)
  async retry(
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ): Promise<{ retried: number }> {
    const retried = await this.queueService.retryFailed(operationId);
    return { retried };
  }

  @Get('metrics/:queueName')
  async getMetrics(
    @Param('queueName')
    queueName: 'statement-generation' | 'matematika-calls' | 'maska-calls',
  ) {
    return this.queueService.getQueueMetrics(queueName);
  }

  private generateOperationId(dto: GenerateStatementDto): string {
    // Детерминированный ID для идемпотентности
    const crypto = require('crypto');
    const hash = crypto
      .createHash('sha256')
      .update(
        `${dto.companyId}:${dto.accountNumber}:${dto.startDate}:${dto.monthsCount}`,
      )
      .digest('hex')
      .slice(0, 16);
    return `${dto.companyId.slice(0, 8)}-${hash}`;
  }
}
