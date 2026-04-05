import { Module } from '@nestjs/common';
import { MatematikaClientService } from './matematika-client.service';
import { MatematikaClientController } from './matematika-client.controller';

@Module({
  controllers: [MatematikaClientController],
  providers: [MatematikaClientService],
})
export class MatematikaClientModule {}
