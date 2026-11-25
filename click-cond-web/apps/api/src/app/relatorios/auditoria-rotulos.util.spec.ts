import {
  mascararDocumento,
  mascararTelefone,
  redigirDetalhesAuditoriaCsv,
  rotuloAcaoAuditoria,
  rotuloModuloAuditoria,
} from './auditoria-rotulos.util';

/**
 * Varredura 25/11 — Log de Auditoria / Log de Eventos:
 *  - CPF inteiro no feed de eventos do porteiro e nos detalhes do CSV;
 *  - ação e módulo crus no CSV (CREATE, facial-health);
 *  - PIN de visita antigo (`codigoAcesso`) gravado nos detalhes vazava no CSV.
 */
describe('auditoria-rotulos.util', () => {
  describe('mascararDocumento', () => {
    it.each([
      ['45346648852', '***.***.*88-52'],
      ['453.466.488-52', '***.***.*88-52'],
      // RG (não é CPF): pontuação preservada, só os 4 últimos dígitos à vista.
      ['12.345.678-9', '**.***.678-9'],
      ['MG1234567', '*****4567'],
    ])('CPF/documento: %s -> só os 4 últimos dígitos', (entrada, saida) => {
      expect(mascararDocumento(entrada)).toBe(saida);
    });

    it('documento curto (até 4 dígitos) some inteiro', () => {
      expect(mascararDocumento('1234')).toBe('****');
    });

    it('vazio/nulo e o rótulo "Não informado" passam', () => {
      expect(mascararDocumento(null)).toBeUndefined();
      expect(mascararDocumento(undefined)).toBeUndefined();
      expect(mascararDocumento('')).toBe('');
      expect(mascararDocumento('Não informado')).toBe('Não informado');
    });
  });

  describe('mascararTelefone', () => {
    it('só os 4 últimos dígitos', () => {
      expect(mascararTelefone('(17) 99660-8148')).toBe('(**) *****-8148');
      expect(mascararTelefone('17996608148')).toBe('*******8148');
      expect(mascararTelefone(null)).toBeUndefined();
    });
  });

  describe('rótulos', () => {
    it.each([
      ['CREATE', 'Criação'],
      ['UPDATE', 'Atualização'],
      ['DELETE', 'Remoção'],
      ['CHECK_IN', 'Entrada'],
      ['CHECK_OUT', 'Saída'],
      ['LOGIN', 'Login'],
      ['LOGIN_FALHA', 'Falha de login'],
      ['EXPORT', 'Exportação'],
      ['ACCESS_GRANTED', 'Acesso liberado'],
      ['ACCESS_DENIED', 'Acesso negado'],
      ['MANUAL_OVERRIDE', 'Abertura manual'],
      ['ONLINE', 'Dispositivo online'],
      ['OFFLINE', 'Dispositivo offline'],
    ])('ação %s -> %s', (acao, rotulo) => {
      expect(rotuloAcaoAuditoria(acao)).toBe(rotulo);
    });

    it('ação desconhecida sai como veio; vazia sai vazia', () => {
      expect(rotuloAcaoAuditoria('NOVA_ACAO')).toBe('NOVA_ACAO');
      expect(rotuloAcaoAuditoria(null)).toBe('');
    });

    it.each([
      ['visitantes', 'Visitantes'],
      ['encomendas', 'Encomendas'],
      ['facial', 'Reconhecimento facial'],
      ['facial-health', 'Reconhecimento facial'],
      ['auth', 'Autenticação'],
      ['AUTH', 'Autenticação'],
      ['credenciais', 'Credenciais'],
      ['portaria-remota', 'Portaria remota'],
      ['guarita', 'Guarita'],
      ['portaria-equipe', 'Equipe da portaria'],
      ['dispositivos', 'Dispositivos'],
      ['sistema', 'Sistema'],
    ])('módulo %s -> %s', (modulo, rotulo) => {
      expect(rotuloModuloAuditoria(modulo)).toBe(rotulo);
    });

    it('módulo desconhecido sai como veio', () => {
      expect(rotuloModuloAuditoria('modulo-novo')).toBe('modulo-novo');
    });
  });

  describe('redigirDetalhesAuditoriaCsv', () => {
    it('remove PIN/código/senha/token, inclusive aninhados', () => {
      const bruto = JSON.stringify({
        nome: 'Maria',
        codigoAcesso: '483920',
        codigo_acesso: '111222',
        pin: '1234',
        otp: '999',
        senha: 'x',
        token: 't',
        visita: { codigoAcesso: '777888', apto: '101' },
        lista: [{ pin: '0000', ok: true }],
      });
      const r = redigirDetalhesAuditoriaCsv(bruto);
      for (const segredo of ['483920', '111222', '1234', '999', '"x"', '"t"', '777888', '0000']) {
        expect(r).not.toContain(segredo);
      }
      expect(JSON.parse(r)).toEqual({ nome: 'Maria', visita: { apto: '101' }, lista: [{ ok: true }] });
    });

    it('mascara documento/cpf/telefone', () => {
      const r = JSON.parse(
        redigirDetalhesAuditoriaCsv(
          JSON.stringify({ documento: '45346648852', cpf: '453.466.488-52', telefone: '17996608148', doc_identificacao: '12345678' }),
        ),
      );
      expect(r).toEqual({
        documento: '***.***.*88-52',
        cpf: '***.***.*88-52',
        // Mesmo formato do util compartilhado (common/auditoria-redacao.util), que o CSV reutiliza.
        telefone: '(**) *****-8148',
        doc_identificacao: '***5678',
      });
    });

    it('texto que não é JSON: apaga o valor de chaves sensíveis no texto', () => {
      const r = redigirDetalhesAuditoriaCsv('codigoAcesso=483920 nome=Maria documento: 45346648852');
      expect(r).not.toContain('483920');
      expect(r).not.toContain('45346648852');
      expect(r).toContain('Maria');
    });

    it('linhas antigas (gravadas cruas) saem redigidas no CSV com a mesma regra do log', () => {
      const antigo = JSON.stringify({
        nome: 'Maria',
        senha_temporaria: 'Tmp@1234',
        novo_pin: '4321',
        webhook_token: 'whk_abcdef',
        codigoAcesso: '483920',
        codigo: '777111',
        qrcode_acesso: 'QR-XYZ-55',
        cpf_morador: '45346648852',
        documento_visitante: '12345678909',
        codigo_rastreio: 'BR123456789',
        changes: {
          documento: { de: '45346648852', para: '12345678909' },
          telefone: { de: '17996608148', para: null },
          qrcode_acesso: { de: 'QR-A', para: 'QR-B' },
        },
      });
      const r = redigirDetalhesAuditoriaCsv(antigo);
      for (const cru of ['Tmp@1234', '4321', 'whk_abcdef', '483920', '777111', 'QR-XYZ', 'QR-A', 'QR-B', '45346648852', '12345678909', '17996608148']) {
        expect(r).not.toContain(cru);
      }
      expect(JSON.parse(r)).toEqual({
        nome: 'Maria',
        cpf_morador: '***.***.*88-52',
        documento_visitante: '***.***.*89-09',
        codigo_rastreio: 'BR123456789',
        changes: {
          documento: { de: '***.***.*88-52', para: '***.***.*89-09' },
          telefone: { de: '(**) *****-8148', para: null },
        },
      });
    });

    it('nulo/vazio vira vazio', () => {
      expect(redigirDetalhesAuditoriaCsv(null)).toBe('');
      expect(redigirDetalhesAuditoriaCsv('')).toBe('');
    });
  });
});

describe('redigirDetalhesAuditoriaCsv — texto antigo que não é JSON', () => {
  it('apaga senha_temporaria, novo_pin, webhook_token e qrcode; mantém codigo_rastreio', () => {
    const r = redigirDetalhesAuditoriaCsv('senha_temporaria=Tmp@1234 novo_pin=4321 webhook_token=whk_abc qrcode_acesso=QR9 codigo_rastreio=BR12');
    for (const cru of ['Tmp@1234', '4321', 'whk_abc', 'QR9']) expect(r).not.toContain(cru);
    expect(r).toContain('codigo_rastreio=BR12');
  });
});
