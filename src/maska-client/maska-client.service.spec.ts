import { Test, TestingModule } from '@nestjs/testing';
import { MaskaClientService } from './maska-client.service';

describe('MaskaClientService', () => {
  let service: MaskaClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MaskaClientService],
    }).compile();

    service = module.get<MaskaClientService>(MaskaClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
