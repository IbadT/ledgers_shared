import { Test, TestingModule } from '@nestjs/testing';
import { DateCalculationService } from './date-calculation.service';

describe('DateCalculationService', () => {
  let service: DateCalculationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DateCalculationService],
    }).compile();

    service = module.get<DateCalculationService>(DateCalculationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
