import { Controller } from '@nestjs/common';
import { MaskaClientService } from './maska-client.service';

@Controller('maska-client')
export class MaskaClientController {
  constructor(private readonly maskaClientService: MaskaClientService) {}
}
