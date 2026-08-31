import { FERRAMENTAS_ACAO } from './chat-ia.acoes';
import { ChatIaService } from './chat-ia.service';

describe('Chat IA - Suporte Multimodal e Extração de Faturas', () => {
  it('montarPartesMensagem inclui inlineData quando há arquivo e texto', () => {
    const service = Object.create(ChatIaService.prototype);
    const arquivo = {
      nome: 'fatura_enel.jpg',
      mime_type: 'image/jpeg',
      base64: 'aGVsbG8=',
    };
    const partes = service.montarPartesMensagem('Analise minha conta de luz', arquivo);

    expect(partes).toHaveLength(2);
    expect(partes[0]).toEqual({
      inlineData: {
        mimeType: 'image/jpeg',
        data: 'aGVsbG8=',
      },
    });
    expect(partes[1]).toEqual({
      text: 'Analise minha conta de luz',
    });
  });

  it('montarPartesMensagem usa fallback de texto quando usuário envia apenas a imagem', () => {
    const service = Object.create(ChatIaService.prototype);
    const arquivo = {
      nome: 'conta.pdf',
      mime_type: 'application/pdf',
      base64: 'cGRmZGF0YQ==',
    };
    const partes = service.montarPartesMensagem('', arquivo);

    expect(partes).toHaveLength(2);
    expect(partes[0].inlineData.mimeType).toBe('application/pdf');
    expect(partes[1].text).toContain('fatura');
  });

  it('propor_conta_morador aceita linha_digitavel e codigo_pix no payload', async () => {
    const f = FERRAMENTAS_ACAO.find((x) => x.nome === 'propor_conta_morador')!;
    expect(f).toBeDefined();

    const res = await f.propor(
      {
        categoria: 'Luz',
        valor: 185.5,
        nome: 'Conta Enel - Agosto/2026',
        data_vencimento: '2026-09-10',
        linha_digitavel: '836100000015025000000000000000000000',
        codigo_pix: '00020126580014br.gov.bcb.pix...',
      },
      {
        idUser: 1,
        idCondominio: 10,
        papel: 'Morador',
        staff: false,
        aptos: [101],
        prisma: {} as any,
        cartoes: [],
      },
    );

    expect(res.proposta).toBeDefined();
    expect(res.proposta?.tipo).toBe('conta_morador');
    expect(res.proposta?.payload?.linha_digitavel).toBe('836100000015025000000000000000000000');
    expect(res.proposta?.payload?.pix_copia_cola).toBe('00020126580014br.gov.bcb.pix...');
    expect(res.proposta?.itens.some((i) => i.rotulo === 'Linha Digitável')).toBe(true);
  });
});
