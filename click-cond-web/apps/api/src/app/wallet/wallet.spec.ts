/**
 * Emissão do passe da Apple, situação, cancelamento (morador e operador) e a
 * opção "Passe na carteira" do condomínio. Prisma em memória; chaves geradas
 * na hora.
 */
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, createHash } from 'node:crypto';
import { decryptSecret } from '../facial/device-secret.util';
import { CredenciaisValidacaoService } from '../credenciais/credenciais-validacao.service';
import { CredenciaisService } from '../credenciais/credenciais.service';
import { diaBrasiliaDe } from '../credenciais/codigo-dinamico.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { WalletService } from './wallet.service';
import { gerarChavesFalsas } from './testes/certificados-falsos';
import { criarPrismaFalso } from './testes/prisma-falso';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');

const MORADOR: JwtPayload = { sub: 7, nome: 'Ana', typeAccess: 'Morador' };
const OUTRO_USUARIO: JwtPayload = { sub: 8, nome: 'Bia', typeAccess: 'Morador' };
const SINDICO: JwtPayload = { sub: 9, nome: 'Síndico', typeAccess: 'Sindico' };
const PORTEIRO: JwtPayload = { sub: 30, nome: 'Zé Portaria', id_condominio: 1, tipo_sub: 'funcionario_portaria' };
const PORTEIRO_OUTRO_COND: JwtPayload = { sub: 31, nome: 'Outro', id_condominio: 2, tipo_sub: 'funcionario_portaria' };
const AGORA = new Date('2026-11-14T12:00:10.000Z');
const falsas = gerarChavesFalsas();
const CHAVES = { chavePem: falsas.passe.chavePem, certPem: falsas.passe.certPem, wwdrPem: falsas.wwdr.certPem };

function passJson(pkpass: Buffer): any {
  return JSON.parse(new AdmZip(pkpass).getEntry('pass.json').getData().toString('utf8'));
}

describe('WalletService', () => {
  const envOriginal = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    if (envOriginal === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = envOriginal;
  });

  function build(opts: { qr?: boolean; wallet?: boolean; semChaves?: boolean } = {}) {
    const { prisma, estado } = criarPrismaFalso({
      condominios: [
        { id: 1, nome: 'Residencial Um', qr_app_habilitado: opts.qr ?? true, wallet_habilitado: opts.wallet ?? true },
        { id: 2, nome: 'Residencial Dois', qr_app_habilitado: true, wallet_habilitado: true },
      ],
      moradores: [
        { id: 11, id_user: 7, id_condominio: 1, nome: 'Ana Souza', bloco: 'A', apartamento: '12', tipo: 'morador' },
        { id: 12, id_user: 7, id_condominio: 2, nome: 'Ana Souza', bloco: null, apartamento: '301', tipo: 'morador' },
        { id: 13, id_user: 8, id_condominio: 1, nome: 'Bia Lima', bloco: 'Bloco B', apartamento: null, tipo: 'morador' },
      ],
    });
    const tenant: any = {
      assertCondominio: jest.fn(async (id: number, user: JwtPayload) => {
        if (user.id_condominio && user.id_condominio !== id) {
          throw new ForbiddenException('Acesso negado: condomínio inválido para esta sessão.');
        }
      }),
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const chaves: any = { apple: jest.fn(async () => (opts.semChaves ? null : CHAVES)) };
    const validacao = new CredenciaisValidacaoService(prisma);
    // Push falso: nenhum teste fala com o APNs de verdade.
    const push = { avisar: jest.fn(async () => ({ status: 200 })) };
    const svc = new WalletService(prisma, validacao, chaves, tenant, auditoria, push);
    const credenciais = new CredenciaisService(prisma, tenant, {} as any, svc);
    return { svc, prisma, estado, tenant, auditoria, chaves, validacao, credenciais };
  }

  describe('emitir (Apple)', () => {
    it('cria credencial wallet_apple e devolve um pkpass cujo barcode valida em validarLeitura no mesmo instante', async () => {
      const { svc, estado, validacao } = build();
      const pkpass = await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      const pass = passJson(pkpass);

      expect(estado.creds).toHaveLength(1);
      const cred = estado.creds[0];
      expect(cred).toMatchObject({
        id_condominio: 1,
        tipo_pessoa: 'morador',
        id_pessoa: 11,
        origem: 'wallet_apple',
        revogada_em: null,
      });
      expect(decryptSecret(cred.segredo)).toMatch(/^[0-9a-f]{64}$/);
      expect(cred.wallet_atualizado_em).toEqual(AGORA);
      expect(pass.serialNumber).toBe(`c${cred.id}`);
      expect(pass.authenticationToken).toBe(svc.tokenDoPasse(cred.id));
      expect(pass.webServiceURL).toBe('https://api.prestarecondominios.com.br/api/wallet/apple');
      expect(pass.generic.primaryFields[0].value).toBe('Ana Souza');
      expect(pass.generic.secondaryFields).toEqual([
        { key: 'condominio', label: 'CONDOMÍNIO', value: 'Residencial Um' },
        { key: 'unidade', label: 'UNIDADE', value: 'Bloco A · Apto 12' },
      ]);

      const r = await validacao.validarLeitura(pass.barcodes[0].message, { id: 42, id_condominio: 1 }, AGORA);
      expect(r).toMatchObject({ ok: true, idCredencial: cred.id, contador: diaBrasiliaDe(AGORA) });
    });

    it('tokenDoPasse é o HMAC do plano: base64url dos 24 primeiros bytes', () => {
      const { svc } = build();
      const base = createHash('sha256').update('segredo-de-teste').digest();
      const esperado = createHmac('sha256', base).update('wallet-auth|123').digest().subarray(0, 24).toString('base64url');
      expect(svc.tokenDoPasse(123)).toBe(esperado);
      expect(esperado).toHaveLength(32);
    });

    it('adicionar de novo devolve o mesmo número de série e o mesmo id de credencial', async () => {
      const { svc, estado } = build();
      const a = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA));
      const b = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, new Date(AGORA.getTime() + 60_000)));
      expect(b.serialNumber).toBe(a.serialNumber);
      expect(b.authenticationToken).toBe(a.authenticationToken);
      expect(estado.creds).toHaveLength(1);
    });

    it('dois toques juntos não criam duas credenciais', async () => {
      const { prisma, estado } = criarPrismaFalso({}, { lento: true });
      const { svc } = build();
      // Troca o Prisma do serviço por um lento com os mesmos dados.
      Object.assign(estado, { condominios: [{ id: 1, nome: 'R', qr_app_habilitado: true, wallet_habilitado: true }] });
      estado.moradores.push({ id: 11, id_user: 7, id_condominio: 1, nome: 'Ana', bloco: null, apartamento: '1' });
      (svc as any).prisma = prisma;
      (svc as any).validacao = new CredenciaisValidacaoService(prisma);
      await Promise.all([svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA), svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA)]);
      expect(estado.creds.filter((c) => c.origem === 'wallet_apple')).toHaveLength(1);
    });

    it('não cria nem altera a credencial de origem app', async () => {
      const { svc, estado } = build();
      estado.creds.push({ id: 50, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'app', segredo: 'x', revogada_em: null });
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      expect(estado.creds.find((c) => c.id === 50)).toEqual({
        id: 50, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'app', segredo: 'x', revogada_em: null,
      });
      expect(estado.creds.filter((c) => c.origem === 'app')).toHaveLength(1);
    });

    it('opção desligada → 400; sem chaves no S3 → 503 (Review Focus 4)', async () => {
      await expect(build({ wallet: false }).svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA)).rejects.toThrow(
        new BadRequestException('Passe na carteira não está ativo neste condomínio.'),
      );
      await expect(build({ qr: false, wallet: true }).svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA)).rejects.toThrow(
        BadRequestException,
      );
      const semChaves = build({ semChaves: true });
      await expect(semChaves.svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA)).rejects.toThrow(
        new ServiceUnavailableException('Passe na carteira indisponível no momento.'),
      );
      expect(semChaves.estado.creds).toHaveLength(0);
    });

    it('usuário sem linha de morador no condomínio → 400', async () => {
      await expect(build().svc.emitirApple(OUTRO_USUARIO, { id_condominio: 2 }, AGORA)).rejects.toThrow(
        new BadRequestException('Seu usuário não tem unidade vinculada neste condomínio.'),
      );
    });

    it('id_condominio inválido → 400; condomínio sem vínculo → erro do tenant', async () => {
      const { svc, tenant } = build();
      await expect(svc.emitirApple(MORADOR, { id_condominio: 'x' as any }, AGORA)).rejects.toThrow(BadRequestException);
      tenant.assertCondominio.mockRejectedValueOnce(new ForbiddenException('Acesso negado.'));
      await expect(svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA)).rejects.toThrow(ForbiddenException);
    });

    it('token que não é do app (porteiro) é recusado', async () => {
      await expect(build().svc.emitirApple(PORTEIRO, { id_condominio: 1 }, AGORA)).rejects.toThrow(ForbiddenException);
    });

    it('morador em dois condomínios recebe passes com números de série diferentes', async () => {
      const { svc } = build();
      const a = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA));
      const b = passJson(await svc.emitirApple(MORADOR, { id_condominio: 2 }, AGORA));
      expect(a.serialNumber).not.toBe(b.serialNumber);
      expect(b.generic.secondaryFields[1].value).toBe('Apto 301');
    });
  });

  describe('situação', () => {
    it('habilitado false quando qr_app_habilitado está desligado, mesmo com wallet_habilitado ligado', async () => {
      const r = await build({ qr: false, wallet: true }).svc.situacao(MORADOR, 1);
      expect(r.habilitado).toBe(false);
    });

    it('disponivel reflete a presença das chaves, por carteira; ativo reflete a credencial', async () => {
      const { svc } = build();
      expect(await svc.situacao(MORADOR, 1)).toEqual({
        habilitado: true,
        apple: { disponivel: true, ativo: false },
        google: { disponivel: false, ativo: false },
      });
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      expect((await svc.situacao(MORADOR, 1)).apple).toEqual({ disponivel: true, ativo: true });
      expect((await svc.situacao(MORADOR, 2)).apple).toEqual({ disponivel: true, ativo: false });

      expect((await build({ semChaves: true }).svc.situacao(MORADOR, 1)).apple).toEqual({ disponivel: false, ativo: false });
    });

    it('sem linha de morador: habilitado false, sem lançar', async () => {
      expect((await build().svc.situacao(OUTRO_USUARIO, 2)).habilitado).toBe(false);
    });
  });

  describe('cancelar', () => {
    it('pelo usuário: revoga apple e google daquele condomínio e não toca no outro condomínio nem na credencial app (Review Focus 2)', async () => {
      const { svc, estado } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      await svc.emitirApple(MORADOR, { id_condominio: 2 }, AGORA);
      estado.creds.push(
        { id: 60, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'wallet_google', segredo: 'x', revogada_em: null },
        { id: 61, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'app', segredo: 'x', revogada_em: null },
        { id: 62, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 13, origem: 'wallet_apple', segredo: 'x', revogada_em: null },
      );
      const depois = new Date(AGORA.getTime() + 5000);
      svc.relogio = () => depois;
      expect(await svc.cancelarDoUsuario(MORADOR, { id_condominio: 1 }, depois)).toEqual({ ok: true });

      const porId = (id: number) => estado.creds.find((c) => c.id === id);
      const apple1 = estado.creds.find((c) => c.origem === 'wallet_apple' && c.id_condominio === 1 && c.id_pessoa === 11);
      const apple2 = estado.creds.find((c) => c.origem === 'wallet_apple' && c.id_condominio === 2);
      expect(apple1.revogada_em).toEqual(depois);
      expect(apple1.wallet_atualizado_em).toEqual(depois);
      expect(porId(60).revogada_em).toEqual(depois);
      expect(porId(61).revogada_em).toBeNull();
      expect(porId(62).revogada_em).toBeNull();
      expect(apple2.revogada_em).toBeNull();
    });

    it('pelo usuário sem passe ativo responde ok do mesmo jeito', async () => {
      expect(await build().svc.cancelarDoUsuario(MORADOR, { id_condominio: 1 }, AGORA)).toEqual({ ok: true });
    });

    it('pelo operador: exige operador, exige o condomínio do morador, registra auditoria com o nome do morador', async () => {
      const { svc, estado, auditoria } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);

      await expect(svc.cancelarPeloOperador(11, MORADOR)).rejects.toThrow(ForbiddenException);
      await expect(svc.cancelarPeloOperador(11, PORTEIRO_OUTRO_COND)).rejects.toThrow(ForbiddenException);
      await expect(svc.cancelarPeloOperador(999, PORTEIRO)).rejects.toThrow(NotFoundException);
      expect(estado.creds[0].revogada_em).toBeNull();
      expect(auditoria.registrar).not.toHaveBeenCalled();

      expect(await svc.cancelarPeloOperador(11, PORTEIRO, AGORA)).toEqual({ ok: true, cancelados: 1 });
      expect(estado.creds[0].revogada_em).toEqual(AGORA);
      expect(auditoria.registrar).toHaveBeenCalledWith({
        id_condominio: 1,
        usuario_nome: 'Zé Portaria',
        autor_id: 30,
        autor_tipo: 'funcionario_portaria',
        acao: 'UPDATE',
        modulo: 'wallet',
        entidade_id: 11,
        descricao: 'Cancelou o passe da carteira de Ana Souza',
        detalhes: { cancelados: 1 },
      });

      expect(await svc.cancelarPeloOperador(11, SINDICO, AGORA)).toEqual({ ok: true, cancelados: 0 });
    });

    it('pelo operador na ficha de outra unidade do mesmo usuário: cancela o passe preso à primeira linha e o P2 passa a ser negado', async () => {
      const { svc, estado, validacao } = build();
      // Ana (usuário 7) mora nos aptos 1 e 2 do mesmo condomínio: linhas 11 e 12.
      estado.moradores = estado.moradores.map((m) =>
        m.id === 12 ? { ...m, id_condominio: 1, bloco: null, apartamento: '2' } : m,
      );
      const pass = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA));
      const cred = estado.creds.find((c) => c.origem === 'wallet_apple');
      expect(cred.id_pessoa).toBe(11);
      expect(await validacao.validarLeitura(pass.barcodes[0].message, { id: 42, id_condominio: 1 }, AGORA)).toMatchObject({ ok: true });

      const r = await svc.cancelarPeloOperador(12, PORTEIRO, AGORA);
      expect(r.cancelados).toBeGreaterThanOrEqual(1);
      expect(cred.revogada_em).toEqual(AGORA);
      expect(await validacao.validarLeitura(pass.barcodes[0].message, { id: 42, id_condominio: 1 }, AGORA)).toMatchObject({
        ok: false,
        motivo: 'revogada',
      });
    });

    it('pelo operador: não toca nos passes de outro usuário nem nos do mesmo usuário em outro condomínio; linha sem id_user só a dela', async () => {
      const { svc, estado } = build();
      estado.moradores.push({ id: 15, id_user: null, id_condominio: 1, nome: 'Sem conta', bloco: null, apartamento: '9' });
      const ativa = (id: number, idPessoa: number, idCondominio = 1) => ({
        id, id_condominio: idCondominio, tipo_pessoa: 'morador', id_pessoa: idPessoa, origem: 'wallet_apple', segredo: 'x', revogada_em: null,
      });
      estado.creds.push(ativa(90, 11), ativa(91, 12, 2), ativa(92, 13), ativa(93, 15));

      expect(await svc.cancelarPeloOperador(11, PORTEIRO, AGORA)).toEqual({ ok: true, cancelados: 1 });
      const porId = (id: number) => estado.creds.find((c) => c.id === id);
      expect(porId(90).revogada_em).toEqual(AGORA);
      expect(porId(91).revogada_em).toBeNull(); // condomínio 2
      expect(porId(92).revogada_em).toBeNull(); // outro usuário
      expect(porId(93).revogada_em).toBeNull(); // linha sem id_user

      expect(await svc.cancelarPeloOperador(15, PORTEIRO, AGORA)).toEqual({ ok: true, cancelados: 1 });
      expect(porId(93).revogada_em).toEqual(AGORA);
      expect(porId(92).revogada_em).toBeNull();
    });

    it('depois de cancelar, passeAppleDaCredencial devolve passe com voided true', async () => {
      const { svc, estado } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      const id = estado.creds[0].id;
      expect(passJson((await svc.passeAppleDaCredencial(id, AGORA))!.pkpass).voided).toBeUndefined();
      await svc.cancelarDoUsuario(MORADOR, { id_condominio: 1 }, AGORA);
      const pass = passJson((await svc.passeAppleDaCredencial(id, AGORA))!.pkpass);
      expect(pass.voided).toBe(true);
      expect(pass.serialNumber).toBe(`c${id}`);
      expect(JSON.stringify(pass)).not.toMatch(/P2[A-Z2-7]{26}/);
    });

    it('cancelar e adicionar de novo cria outro passe (outro número de série)', async () => {
      const { svc } = build();
      const a = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA));
      await svc.cancelarDoUsuario(MORADOR, { id_condominio: 1 }, AGORA);
      const b = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA));
      expect(b.serialNumber).not.toBe(a.serialNumber);
    });
  });

  describe('passeAppleDaCredencial', () => {
    it('null para credencial inexistente ou que não é wallet_apple', async () => {
      const { svc, estado } = build();
      estado.creds.push({ id: 70, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'app', segredo: 'x', revogada_em: null });
      expect(await svc.passeAppleDaCredencial(999, AGORA)).toBeNull();
      expect(await svc.passeAppleDaCredencial(70, AGORA)).toBeNull();
    });

    it('morador removido: passe inválido', async () => {
      const { svc, estado } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      estado.moradores = estado.moradores.filter((m) => m.id !== 11);
      expect(passJson((await svc.passeAppleDaCredencial(estado.creds[0].id, AGORA))!.pkpass).voided).toBe(true);
    });

    it('sem chaves: 503, não null', async () => {
      const { svc, estado, chaves } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      chaves.apple.mockResolvedValue(null);
      await expect(svc.passeAppleDaCredencial(estado.creds[0].id, AGORA)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('opção do condomínio', () => {
    it('GET devolve os dois campos', async () => {
      const { credenciais } = build({ qr: true, wallet: false });
      expect(await credenciais.lerOpcao(1, SINDICO)).toEqual({ qr_app_habilitado: true, wallet_habilitado: false });
    });

    it('não liga wallet com QR no app desligado', async () => {
      const { credenciais, estado } = build({ qr: false, wallet: false });
      await expect(credenciais.definirOpcao(1, { wallet_habilitado: true }, SINDICO)).rejects.toThrow(
        new BadRequestException('Ligue primeiro o QR no app.'),
      );
      expect(estado.condominios[0].wallet_habilitado).toBe(false);
      // Os dois juntos podem.
      expect(await credenciais.definirOpcao(1, { qr_app_habilitado: true, wallet_habilitado: true }, SINDICO)).toEqual({
        qr_app_habilitado: true,
        wallet_habilitado: true,
      });
    });

    it('wallet exige síndico e valor booleano', async () => {
      const { credenciais } = build();
      await expect(credenciais.definirOpcao(1, { wallet_habilitado: true }, PORTEIRO)).rejects.toThrow(ForbiddenException);
      await expect(credenciais.definirOpcao(1, { wallet_habilitado: 'sim' as any }, SINDICO)).rejects.toThrow(BadRequestException);
      await expect(credenciais.definirOpcao(1, {}, SINDICO)).rejects.toThrow(BadRequestException);
    });

    it('desligar QR no app desliga wallet junto', async () => {
      const { credenciais, estado } = build();
      expect(await credenciais.definirOpcao(1, { qr_app_habilitado: false }, SINDICO)).toEqual({
        qr_app_habilitado: false,
        wallet_habilitado: false,
      });
      expect(estado.condominios[0]).toMatchObject({ qr_app_habilitado: false, wallet_habilitado: false });
    });

    it('desligar wallet não revoga nem anula: o passe fica pausado (código mantido, aviso no verso) e a validação nega; religar tira o aviso', async () => {
      const { svc, credenciais, estado, validacao } = build();
      const a = passJson(await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA));
      const id = estado.creds[0].id;
      const pausado = (pass: any) => pass.generic.backFields.some((f: any) => f.value === 'Passe pausado pelo condomínio');
      expect(pausado(a)).toBe(false);

      const antes = estado.creds[0].wallet_atualizado_em;
      await credenciais.definirOpcao(1, { wallet_habilitado: false }, SINDICO);
      expect(estado.creds[0].revogada_em).toBeNull();
      expect(estado.creds[0].wallet_atualizado_em).not.toEqual(antes);
      const desligado = passJson((await svc.passeAppleDaCredencial(id, AGORA))!.pkpass);
      expect(desligado.voided).toBeUndefined();
      expect(desligado.expirationDate).toBeUndefined();
      expect(desligado.barcodes[0].message).toBe(a.barcodes[0].message);
      expect(pausado(desligado)).toBe(true);
      expect(await validacao.validarLeitura(desligado.barcodes[0].message, { id: 42, id_condominio: 1 }, AGORA)).toMatchObject({
        ok: false,
        motivo: 'carteira_desligada',
      });

      await credenciais.definirOpcao(1, { wallet_habilitado: true }, SINDICO);
      const b = passJson((await svc.passeAppleDaCredencial(id, AGORA))!.pkpass);
      expect(b.voided).toBeUndefined();
      expect(pausado(b)).toBe(false);
      expect(b.serialNumber).toBe(a.serialNumber);
    });

    it('QR no app desligado também só pausa o passe', async () => {
      const { svc, credenciais, estado } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      await credenciais.definirOpcao(1, { qr_app_habilitado: false }, SINDICO);
      const pass = passJson((await svc.passeAppleDaCredencial(estado.creds[0].id, AGORA))!.pkpass);
      expect(pass.voided).toBeUndefined();
      expect(pass.barcodes[0].message).toMatch(/^P2[A-Z2-7]{26}$/);
    });

    it('mudança que não altera o efeito não marca os passes', async () => {
      const { svc, credenciais, estado } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      const antes = estado.creds[0].wallet_atualizado_em;
      await credenciais.definirOpcao(1, { wallet_habilitado: true }, SINDICO);
      expect(estado.creds[0].wallet_atualizado_em).toEqual(antes);
    });
  });

  describe('wallet_atualizado_em', () => {
    // Bem à frente do relógio real: o que for gravado com a hora atual é menor.
    const FUTURO = new Date('2030-01-01T00:00:00.000Z');
    const ativa = (extra: any = {}) => ({
      id: 95, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'wallet_apple', segredo: 'x',
      revogada_em: null, wallet_atualizado_em: FUTURO, ...extra,
    });

    it('marcarAtualizado grava a hora do momento da escrita e nunca menor que a atual', async () => {
      const { svc, estado } = build();
      estado.creds.push(ativa());
      await svc.marcarAtualizado([95]);
      expect(estado.creds[0].wallet_atualizado_em).toEqual(FUTURO);

      const depois = new Date(FUTURO.getTime() + 1000);
      svc.relogio = () => depois;
      await svc.marcarAtualizado([95]);
      expect(estado.creds[0].wallet_atualizado_em).toEqual(depois);

      estado.creds.push(ativa({ id: 96, wallet_atualizado_em: null }));
      await svc.marcarAtualizado([96]);
      expect(estado.creds[1].wallet_atualizado_em).toEqual(depois);
    });

    it('cancelar com o instante do início do pedido não faz a coluna andar para trás', async () => {
      const { svc, estado } = build();
      estado.creds.push(ativa());
      await svc.cancelarDoUsuario(MORADOR, { id_condominio: 1 }, AGORA);
      expect(estado.creds[0].revogada_em).toEqual(AGORA);
      expect(estado.creds[0].wallet_atualizado_em).toEqual(FUTURO);
    });
  });

  describe('morador removido', () => {
    it('revogarDoMorador revoga as credenciais de carteira e marca, sem tocar na do app', async () => {
      const { svc, estado } = build();
      await svc.emitirApple(MORADOR, { id_condominio: 1 }, AGORA);
      estado.creds.push({ id: 80, id_condominio: 1, tipo_pessoa: 'morador', id_pessoa: 11, origem: 'app', segredo: 'x', revogada_em: null });
      await svc.revogarDoMorador(11, 1, AGORA);
      expect(estado.creds.find((c) => c.origem === 'wallet_apple').revogada_em).toEqual(AGORA);
      expect(estado.creds.find((c) => c.id === 80).revogada_em).toBeNull();
    });

    it('MoradoresService.remove chama revogarDoMorador depois de excluir', async () => {
      const m = { id: 11, nome: 'Ana', id_condominio: 1, id_user: null, face_id: null, bloco: 'A', apartamento: '12' };
      const prisma: any = {
        isConnected: true,
        moradores: { findUnique: jest.fn(async () => m), delete: jest.fn(async () => m) },
        $transaction: jest.fn(async (fn: any) => fn(prisma)),
      };
      const wallet = { revogarDoMorador: jest.fn(async () => undefined) };
      const { MoradoresService } = await import('../moradores/moradores.service');
      const svc = new MoradoresService(prisma, {} as any, {} as any, {} as any, { registrar: jest.fn() } as any, {} as any, wallet as any);
      await svc.remove(11, SINDICO);
      expect(prisma.moradores.delete).toHaveBeenCalled();
      expect(wallet.revogarDoMorador).toHaveBeenCalledWith(11, 1);
    });

    it('revogarDoMorador nunca lança', async () => {
      const { svc, prisma } = build();
      prisma.credenciais_Acesso.findMany.mockRejectedValueOnce(new Error('banco fora'));
      await expect(svc.revogarDoMorador(11, 1, AGORA)).resolves.toBeUndefined();
    });
  });
});
