import { Test, TestingModule } from '@nestjs/testing';
import { MaskaClientController } from './maska-client.controller';
import { MaskaClientService } from './maska-client.service';

describe('MaskaClientController', () => {
  let controller: MaskaClientController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaskaClientController],
      providers: [MaskaClientService],
    }).compile();

    controller = module.get<MaskaClientController>(MaskaClientController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
