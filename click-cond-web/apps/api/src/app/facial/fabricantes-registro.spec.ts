import {
  FABRICANTES_COM_CAMERA,
  FABRICANTES_COM_LISTAGEM,
  normalizarFabricante as normalizarAtual,
} from './facial.service';
import {
  FABRICANTES_COM_DESCOBERTA,
  FABRICANTES_SUPORTADOS,
  FABRICANTE_GENERICO,
  listarFabricantes,
  normalizarFabricante,
  protocoloSemHttp,
  temCapacidade,
  valoresGravadosCom,
} from './fabricantes';

/**
 * Registro único de fabricantes: uma só tabela responde "que marca é esta?" e
 * "esta marca sabe fazer X?". Estes testes travam que o registro reproduz
 * EXATAMENTE o que as listas espalhadas pelo módulo faziam.
 */
describe('registro de fabricantes', () => {
  describe('normalizarFabricante', () => {
    it.each([
      // valores que o banco já tem gravados — nenhum muda de tratamento
      ['intelbras', 'intelbras'],
      ['dahua', 'intelbras'],
      ['hikvision', 'hikvision'],
      ['control_id', 'control_id'],
      ['genérico', 'genérico'],
      ['zkteco', 'zkteco'],
      ['topdata', 'topdata'],
      ['henry', 'henry'],
      // aliases e grafias
      ['hik', 'hikvision'],
      ['controlid', 'control_id'],
      ['control id', 'control_id'],
      ['control-id', 'control_id'],
      ['generico', 'genérico'],
      ['  Intelbras ', 'intelbras'],
      ['DAHUA', 'intelbras'],
      ['HikVision', 'hikvision'],
      ['Control iD', 'control_id'],
      ['GENÉRICO', 'genérico'],
    ])('%j → %j', (bruto, canonico) => {
      expect(normalizarFabricante(bruto)).toBe(canonico);
    });

    it.each([['acme'], [''], ['   '], [null], [undefined], [42], [{}], ['constructor'], ['__proto__']])(
      'desconhecido (%j) → null',
      (bruto) => {
        expect(normalizarFabricante(bruto)).toBeNull();
      },
    );

    // Trocar a função de facial.service.ts pela do registro não pode mudar o
    // que o agente recebe no poll para nenhum valor hoje aceito.
    it.each(['intelbras', 'dahua', 'hikvision', 'control_id', 'genérico', 'zkteco', 'topdata', 'henry'])(
      'dá o mesmo resultado que a normalizarFabricante atual de facial.service.ts para %j',
      (gravado) => {
        expect(normalizarFabricante(gravado)).toBe(normalizarAtual(gravado));
      },
    );
  });

  describe('famílias', () => {
    it('agrupa pelo protocolo, como o registro de drivers do agente', () => {
      expect(FABRICANTES_SUPORTADOS.intelbras.familia).toBe('dahua');
      expect(FABRICANTES_SUPORTADOS.hikvision.familia).toBe('hikvision');
      expect(FABRICANTES_SUPORTADOS.control_id.familia).toBe('control_id');
      expect(FABRICANTES_SUPORTADOS[FABRICANTE_GENERICO].familia).toBe('generico');
      for (const semHttp of ['zkteco', 'topdata', 'henry'] as const) {
        expect(FABRICANTES_SUPORTADOS[semHttp].familia).toBe('sem_http');
      }
    });
  });

  describe('capacidades', () => {
    it('valores gravados com listagem = FABRICANTES_COM_LISTAGEM de facial.service.ts', () => {
      expect([...valoresGravadosCom('listagem')].sort()).toEqual([...FABRICANTES_COM_LISTAGEM].sort());
    });

    it('valores gravados com câmera = FABRICANTES_COM_CAMERA de facial.service.ts', () => {
      expect([...valoresGravadosCom('camera')].sort()).toEqual([...FABRICANTES_COM_CAMERA].sort());
    });

    it('descoberta = as três marcas que o agente sabe achar na rede, nessa ordem', () => {
      expect(FABRICANTES_COM_DESCOBERTA).toEqual(['intelbras', 'hikvision', 'control_id']);
    });

    it.each([
      // [fabricante, listagem, camera, validadeNoAparelho, usoUnico, eventosViaAgente, descoberta]
      ['intelbras', true, true, true, true, true, true],
      ['dahua', true, true, true, true, true, true],
      ['hikvision', true, true, true, false, true, true],
      ['control_id', true, false, false, false, true, true],
      ['genérico', false, false, false, false, false, false],
      ['zkteco', false, false, false, false, false, false],
      ['topdata', false, false, false, false, false, false],
      ['henry', false, false, false, false, false, false],
      ['acme', false, false, false, false, false, false],
    ])('%s', (fab, listagem, camera, validade, usoUnico, eventos, descoberta) => {
      expect(temCapacidade(fab, 'listagem')).toBe(listagem);
      expect(temCapacidade(fab, 'camera')).toBe(camera);
      expect(temCapacidade(fab, 'validadeNoAparelho')).toBe(validade);
      expect(temCapacidade(fab, 'usoUnico')).toBe(usoUnico);
      expect(temCapacidade(fab, 'eventosViaAgente')).toBe(eventos);
      expect(temCapacidade(fab, 'descoberta')).toBe(descoberta);
    });
  });

  describe('protocoloSemHttp', () => {
    it('descreve o protocolo das marcas que não aceitam comando HTTP', () => {
      expect(protocoloSemHttp('zkteco')).toBe('protocolo TCP/UDP na porta 4370 (PULL/PUSH SDK)');
      expect(protocoloSemHttp('topdata')).toBe('protocolo TCP na porta 3570 (SDK Inner)');
      expect(protocoloSemHttp('henry')).toBe('protocolo proprietário (SDK Henry)');
    });

    it.each(['intelbras', 'hikvision', 'control_id', 'genérico', 'acme', 'constructor'])(
      '%s fala HTTP (ou é desconhecido): undefined',
      (fab) => {
        expect(protocoloSemHttp(fab)).toBeUndefined();
      },
    );
  });

  describe('listarFabricantes', () => {
    it('devolve uma linha por chave canônica, com rótulo, padrões e capacidades', () => {
      const lista = listarFabricantes();
      expect(lista.map((f) => f.chave)).toEqual(Object.keys(FABRICANTES_SUPORTADOS));
      const cid = lista.find((f) => f.chave === 'control_id');
      expect(cid).toEqual({
        chave: 'control_id',
        rotulo: 'Control iD',
        familia: 'control_id',
        portaPadrao: 80,
        usuarioPadrao: 'admin',
        capacidades: {
          listagem: true,
          camera: false,
          validadeNoAparelho: false,
          usoUnico: false,
          eventosViaAgente: true,
          descoberta: true,
        },
      });
    });

    it('é cópia: mexer no retorno não altera o registro', () => {
      const [primeiro] = listarFabricantes();
      primeiro.capacidades.listagem = !primeiro.capacidades.listagem;
      expect(listarFabricantes()[0].capacidades.listagem).not.toBe(primeiro.capacidades.listagem);
    });
  });
});
