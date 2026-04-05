import { Test, TestingModule } from '@nestjs/testing';
import { MatematikaClientController } from './matematika-client.controller';
import { MatematikaClientService } from './matematika-client.service';

describe('MatematikaClientController', () => {
  let controller: MatematikaClientController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MatematikaClientController],
      providers: [MatematikaClientService],
    }).compile();

    controller = module.get<MatematikaClientController>(MatematikaClientController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
