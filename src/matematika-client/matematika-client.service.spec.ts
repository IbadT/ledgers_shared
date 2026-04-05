import { Test, TestingModule } from '@nestjs/testing';
import { MatematikaClientService } from './matematika-client.service';

describe('MatematikaClientService', () => {
  let service: MatematikaClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatematikaClientService],
    }).compile();

    service = module.get<MatematikaClientService>(MatematikaClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
