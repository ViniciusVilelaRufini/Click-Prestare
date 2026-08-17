import {
  FABRICANTES_COM_CAMERA,
  FABRICANTES_COM_LISTAGEM,
  normalizarFabricante,
} from './facial.service';

/**
 * Trava as regressões de suporte multimarca: antes destas garantias, um
 * terminal Hikvision ou Control iD era cadastrado normalmente mas ficava fora
 * da varredura de fantasmas — um rosto EXCLUÍDO continuava abrindo a porta
 * quando o unsync não alcançou o aparelho.
 */
describe('capacidades por fabricante', () => {
  describe('normalizarFabricante', () => {
    // A Intelbras é OEM da Dahua: mesmo firmware, mesmo protocolo. Sem isso, um
    // device gravado como 'dahua' caía no caminho HTTP genérico /persons e o
    // cadastro nunca chegava ao aparelho.
    it('trata dahua como intelbras', () => {
      expect(normalizarFabricante('dahua')).toBe('intelbras');
    });

    it('preserva as demais marcas', () => {
      expect(normalizarFabricante('intelbras')).toBe('intelbras');
      expect(normalizarFabricante('hikvision')).toBe('hikvision');
      expect(normalizarFabricante('control_id')).toBe('control_id');
      expect(normalizarFabricante('genérico')).toBe('genérico');
    });
  });

  describe('FABRICANTES_COM_LISTAGEM', () => {
    it('cobre todas as marcas de terminal facial suportadas', () => {
      expect(FABRICANTES_COM_LISTAGEM).toContain('intelbras');
      expect(FABRICANTES_COM_LISTAGEM).toContain('dahua');
      expect(FABRICANTES_COM_LISTAGEM).toContain('hikvision');
      expect(FABRICANTES_COM_LISTAGEM).toContain('control_id');
    });

    // ZKTeco/Topdata/Henry falam protocolo binário, não HTTP: listar pessoas é
    // impossível e a varredura só produziria erro a cada hora.
    it('não inclui marcas sem comando HTTP', () => {
      for (const semHttp of ['zkteco', 'topdata', 'henry']) {
        expect(FABRICANTES_COM_LISTAGEM).not.toContain(semHttp);
      }
    });
  });

  describe('FABRICANTES_COM_CAMERA', () => {
    // Control iD não expõe captura de quadro pela câmera do terminal.
    it('exclui control_id e inclui as linhas com snapshot', () => {
      expect(FABRICANTES_COM_CAMERA).toContain('intelbras');
      expect(FABRICANTES_COM_CAMERA).toContain('hikvision');
      expect(FABRICANTES_COM_CAMERA).not.toContain('control_id');
    });
  });
});
