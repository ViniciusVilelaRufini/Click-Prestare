import { aplicarLeitura } from './foto-encomenda';
import { CreateEncomenda } from './encomendas.service';
import { Apartamento } from '../apartamentos/apartamentos.service';

const apto = (id: number, a: string, bloco: string | null) => ({ id, apto: a, bloco }) as unknown as Apartamento;
const aptos = [apto(1, '101', 'A'), apto(2, '106', 'A'), apto(3, '106', 'B')];
const vazio = (): CreateEncomenda => ({ descricao: '', destinatario_apto: '', destinatario_bloco: '', recebido_de: '', codigo_rastreio: '' });
const leitura = (o: Partial<Record<string, string | null>> = {}) => ({
  nome: null, apto: null, bloco: null, transportadora: null, codigo_rastreio: null, descricao: null, ...o,
});

describe('aplicarLeitura', () => {
  it('preenche formulário vazio e seleciona o apto existente', () => {
    const r = aplicarLeitura(vazio(), null, aptos, {
      leitura: leitura({ transportadora: 'Correios', codigo_rastreio: 'AB123', descricao: 'Caixa pequena' }),
      destinatario: { apto: '106', bloco: 'A', nome: 'Ana' },
    });
    expect(r.selecionado).toBe(aptos[1]);
    expect(r.novo.recebido_de).toBe('Correios');
    expect(r.novo.codigo_rastreio).toBe('AB123');
    expect(r.novo.descricao).toBe('Caixa pequena');
    expect(r.preencheu).toBe(true);
  });

  it('mantém o que o porteiro já digitou/escolheu', () => {
    const novo = { ...vazio(), descricao: 'Minha descrição' };
    const sel = aptos[0];
    const r = aplicarLeitura(novo, sel, aptos, {
      leitura: leitura({ descricao: 'Outra' }),
      destinatario: { apto: '106', bloco: 'A', nome: 'Ana' },
    });
    expect(r.novo.descricao).toBe('Minha descrição');
    expect(r.selecionado).toBe(sel);
  });

  it('destinatário inexistente não altera a seleção', () => {
    const r = aplicarLeitura(vazio(), null, aptos, {
      leitura: leitura({ codigo_rastreio: 'X' }),
      destinatario: { apto: '999', bloco: null, nome: 'Z' },
    });
    expect(r.selecionado).toBeNull();
  });

  it('leitura vazia não preenche', () => {
    const r = aplicarLeitura(vazio(), null, aptos, { leitura: leitura(), destinatario: null });
    expect(r.preencheu).toBe(false);
  });
});
