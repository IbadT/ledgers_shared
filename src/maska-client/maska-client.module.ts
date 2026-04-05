import { Module } from '@nestjs/common';
import { MaskaClientService } from './maska-client.service';
import { MaskaClientController } from './maska-client.controller';

@Module({
  controllers: [MaskaClientController],
  providers: [MaskaClientService],
})
export class MaskaClientModule {}
