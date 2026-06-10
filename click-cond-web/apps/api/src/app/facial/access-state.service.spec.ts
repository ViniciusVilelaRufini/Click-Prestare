import { AccessStateService } from './access-state.service';

describe('AccessStateService', () => {
  afterEach(() => {
    delete process.env.ANTI_PASSBACK_MODE;
    delete process.env.ACCESS_COOLDOWN_MS;
  });

  describe('shouldDebounce', () => {
    it('descarta evento duplicado do mesmo leitor/credencial/sentido dentro da janela', () => {
      const svc = new AccessStateService();
      expect(svc.shouldDebounce(1, 'TAG123', 'entrada')).toBe(false);
      expect(svc.shouldDebounce(1, 'TAG123', 'entrada')).toBe(true);
    });

    it('NÃO descarta sentido oposto: entrada seguida de saída é fluxo legítimo', () => {
      const svc = new AccessStateService();
      expect(svc.shouldDebounce(1, 'TAG123', 'entrada')).toBe(false);
      expect(svc.shouldDebounce(1, 'TAG123', 'saida')).toBe(false);
    });

    it('não mistura devices nem credenciais diferentes', () => {
      const svc = new AccessStateService();
      expect(svc.shouldDebounce(1, 'TAG123', 'entrada')).toBe(false);
      expect(svc.shouldDebounce(2, 'TAG123', 'entrada')).toBe(false);
      expect(svc.shouldDebounce(1, 'TAG999', 'entrada')).toBe(false);
    });

    it('credencial vazia nunca debounça', () => {
      const svc = new AccessStateService();
      expect(svc.shouldDebounce(1, '', 'entrada')).toBe(false);
      expect(svc.shouldDebounce(1, '', 'entrada')).toBe(false);
    });
  });

  describe('checkAntiPassback', () => {
    it('modo off: sempre permite, mesmo com entrada dupla', () => {
      process.env.ANTI_PASSBACK_MODE = 'off';
      const svc = new AccessStateService();
      expect(svc.checkAntiPassback(1, 'morador', 10, 'entrada')).toBe('allow');
      expect(svc.checkAntiPassback(1, 'morador', 10, 'entrada')).toBe('allow');
    });

    it('modo hard: nega entrada de quem já está dentro (crachá clonado)', () => {
      process.env.ANTI_PASSBACK_MODE = 'hard';
      const svc = new AccessStateService();
      expect(svc.checkAntiPassback(1, 'visitante', 10, 'entrada')).toBe('allow');
      expect(svc.checkAntiPassback(1, 'visitante', 10, 'entrada')).toBe('deny');
      // após sair, pode entrar de novo
      expect(svc.checkAntiPassback(1, 'visitante', 10, 'saida')).toBe('allow');
      expect(svc.checkAntiPassback(1, 'visitante', 10, 'entrada')).toBe('allow');
    });

    it('modo hard: nega saída de quem está fora', () => {
      process.env.ANTI_PASSBACK_MODE = 'hard';
      const svc = new AccessStateService();
      expect(svc.checkAntiPassback(1, 'morador', 10, 'saida')).toBe('deny');
    });

    it('modo soft: permite com aviso na violação e atualiza o estado', () => {
      process.env.ANTI_PASSBACK_MODE = 'soft';
      const svc = new AccessStateService();
      expect(svc.checkAntiPassback(1, 'prestador', 10, 'entrada')).toBe('allow');
      expect(svc.checkAntiPassback(1, 'prestador', 10, 'entrada')).toBe('allow_with_warning');
    });

    it('estado é isolado por condomínio e por pessoa', () => {
      process.env.ANTI_PASSBACK_MODE = 'hard';
      const svc = new AccessStateService();
      expect(svc.checkAntiPassback(1, 'morador', 10, 'entrada')).toBe('allow');
      // mesma pessoa em outro condomínio e outra pessoa no mesmo condomínio: livres
      expect(svc.checkAntiPassback(2, 'morador', 10, 'entrada')).toBe('allow');
      expect(svc.checkAntiPassback(1, 'morador', 11, 'entrada')).toBe('allow');
    });

    it('setPresenca permite correção administrativa do estado', () => {
      process.env.ANTI_PASSBACK_MODE = 'hard';
      const svc = new AccessStateService();
      expect(svc.checkAntiPassback(1, 'morador', 10, 'entrada')).toBe('allow');
      svc.setPresenca(1, 'morador', 10, 'fora');
      expect(svc.checkAntiPassback(1, 'morador', 10, 'entrada')).toBe('allow');
    });
  });
});
