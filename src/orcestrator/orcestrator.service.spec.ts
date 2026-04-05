import { Test, TestingModule } from '@nestjs/testing';
import { OrcestratorService } from './orcestrator.service';

describe('OrcestratorService', () => {
  let service: OrcestratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrcestratorService],
    }).compile();

    service = module.get<OrcestratorService>(OrcestratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
