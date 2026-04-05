import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { CounterpartyService } from './counterparty.service';
import { CreateCounterpartyDto } from './dto/create-counterparty.dto';
import { UpdateCounterpartyDto } from './dto/update-counterparty.dto';

@Controller('counterparty')
export class CounterpartyController {
  constructor(private readonly counterpartyService: CounterpartyService) {}
}
