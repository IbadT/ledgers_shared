import { PartialType } from '@nestjs/swagger';
import { CreateDateCalculationDto } from './create-date-calculation.dto';

export class UpdateDateCalculationDto extends PartialType(CreateDateCalculationDto) {}
