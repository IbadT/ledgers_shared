import { Controller } from '@nestjs/common';
import { MatematikaClientService } from './matematika-client.service';

@Controller('matematika-client')
export class MatematikaClientController {
  constructor(private readonly matematikaClientService: MatematikaClientService) {}
}
