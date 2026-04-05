import { Test, TestingModule } from '@nestjs/testing';
import { DateCalculationController } from './date-calculation.controller';
import { DateCalculationService } from './date-calculation.service';

describe('DateCalculationController', () => {
  let controller: DateCalculationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DateCalculationController],
      providers: [DateCalculationService],
    }).compile();

    controller = module.get<DateCalculationController>(DateCalculationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
