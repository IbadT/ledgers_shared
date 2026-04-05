import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { DateCalculationService } from './date-calculation.service';
import { CreateDateCalculationDto } from './dto/create-date-calculation.dto';
import { UpdateDateCalculationDto } from './dto/update-date-calculation.dto';

@Controller('date-calculation')
export class DateCalculationController {
  constructor(
    private readonly dateCalculationService: DateCalculationService,
  ) {}
}
