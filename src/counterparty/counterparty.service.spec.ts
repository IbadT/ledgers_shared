import { Test, TestingModule } from '@nestjs/testing';
import { CounterpartyService } from './counterparty.service';

describe('CounterpartyService', () => {
  let service: CounterpartyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CounterpartyService],
    }).compile();

    service = module.get<CounterpartyService>(CounterpartyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
