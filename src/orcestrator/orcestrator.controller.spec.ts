import { Test, TestingModule } from '@nestjs/testing';
import { OrcestratorController } from './orcestrator.controller';
import { OrcestratorService } from './orcestrator.service';

describe('OrcestratorController', () => {
  let controller: OrcestratorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrcestratorController],
      providers: [OrcestratorService],
    }).compile();

    controller = module.get<OrcestratorController>(OrcestratorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
