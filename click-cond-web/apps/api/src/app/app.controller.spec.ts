import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
  });

  describe('getData', () => {
    it('should return "Hello API"', () => {
      const appController = app.get<AppController>(AppController);
      expect(appController.getData()).toEqual({ message: 'Hello API' });
    });
  });

  describe('getHealth', () => {
    it('should return status ok', () => {
      const appController = app.get<AppController>(AppController);
      const health = appController.getHealth();
      expect(health.status).toBe('ok');
      expect(health.timestamp).toBeDefined();
    });

    it('getHealthApi should return status ok', () => {
      const appController = app.get<AppController>(AppController);
      const health = appController.getHealthApi();
      expect(health.status).toBe('ok');
    });
  });
});

// /debug-ip era público e devolvia os IPs da cadeia de proxies (CloudFront,
// load balancer) a qualquer um. Serviu para diagnosticar o trust proxy e não
// tem consumidor: não pode voltar como rota pública.
describe('AppController — sem rota de diagnóstico pública', () => {
  it('não expõe debug-ip', () => {
    expect((AppController.prototype as any).getDebugIp).toBeUndefined();
    expect((AppController.prototype as any).getDebugIpApi).toBeUndefined();
  });
});
