import { Test, TestingModule } from '@nestjs/testing';
import { CounterpartyController } from './counterparty.controller';
import { CounterpartyService } from './counterparty.service';

describe('CounterpartyController', () => {
  let controller: CounterpartyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CounterpartyController],
      providers: [CounterpartyService],
    }).compile();

    controller = module.get<CounterpartyController>(CounterpartyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
