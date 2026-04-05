import { Body, Controller, Inject, Post } from '@nestjs/common';
import {
  ClientProxy,
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';

@Controller('orcestrator')
export class OrcestratorController {
  constructor(
    @Inject('SHARED_SERVICE') private readonly sharedClient: ClientProxy,
  ) {}

  // ✅ Отправка
  @Post('send-user')
  async sendUser() {
    const userData = { name: 'Eduard', age: 24 };
    console.log(`📤 Sending:`, userData);
    return await this.sharedClient.send('user.process', userData).toPromise();
  }

  // ✅ Получение (только это и нужно)
  @MessagePattern('user.process')
  async handleUserProcess(
    @Payload() user: { name: string; age: number },
    @Ctx() context: RmqContext,
  ) {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║   📨 DATA RECEIVED FROM RABBITMQ BROKER                   ║
╠═══════════════════════════════════════════════════════════╣
║   User name: ${user.name.padEnd(35)}                      ║
║   User age:  ${user.age.toString().padEnd(35)}            ║
╚═══════════════════════════════════════════════════════════╝
    `);

    const channel = context.getChannelRef();
    const message = context.getMessage();

    channel.ack(message);

    return { status: 'processed', received: user };
  }

  // ========== НОВЫЙ РОУТ ==========
  @Post('calculate')
  async calculate(
    @Body()
    data: {
      numbers: number[];
      operation: 'sum' | 'multiply' | 'average';
    },
  ) {
    console.log(`📤 Sending calculation request to RabbitMQ:`, data);

    return await this.sharedClient.send('math.calculate', data).toPromise();
  }

  @MessagePattern('math.calculate')
  async handleCalculation(
    @Payload()
    data: { numbers: number[]; operation: 'sum' | 'multiply' | 'average' },
    @Ctx() context: RmqContext,
  ) {
    console.log(`📨 Received calculation request:`, data);

    let result: number;
    let operationName: string;

    switch (data.operation) {
      case 'sum':
        result = data.numbers.reduce((acc, num) => acc + num, 0);
        operationName = 'Sum';
        break;
      case 'multiply':
        result = data.numbers.reduce((acc, num) => acc * num, 1);
        operationName = 'Multiplication';
        break;
      case 'average':
        result =
          data.numbers.reduce((acc, num) => acc + num, 0) / data.numbers.length;
        operationName = 'Average';
        break;
      default:
        throw new Error(`Unknown operation: ${data.operation}`);
    }

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║   🧮 CALCULATION RESULT FROM RABBITMQ BROKER             ║
╠═══════════════════════════════════════════════════════════╣
║   Operation: ${operationName.padEnd(35)}║
║   Numbers:   ${data.numbers.join(', ').padEnd(35)}║
║   Result:    ${result.toString().padEnd(35)}║
╚═══════════════════════════════════════════════════════════╝
    `);

    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();
    channel.ack(originalMessage);

    return {
      status: 'calculated',
      operation: data.operation,
      numbers: data.numbers,
      result,
      timestamp: new Date(),
    };
  }
}
