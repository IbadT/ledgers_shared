import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppLogger } from './logger.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [AppLogger],
  exports: [AppLogger],
})
export class SharedModule {}
