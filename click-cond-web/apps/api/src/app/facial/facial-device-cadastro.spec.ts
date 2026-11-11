import { BadRequestException } from '@nestjs/common';
import { FacialService } from './facial.service';

/**
 * Cadastro/edição de dispositivo:
 *  - validação mínima dos campos (antes o erro era um 500 cru do Prisma);
 *  - bloqueio de duplicado (mesmo ip:porta ou mesmo MAC E mesmo tipo, ativos,
 *    no condomínio) — tipo diferente no mesmo endereço é permitido: é o relé
 *    do próprio terminal facial cadastrado como botoeira/catraca;
 *  - `controle_acesso_facial` aplicado também na criação;
 *  - terminal facial novo/reativado/reendereçado recebe a carga completa de
 *    rostos SÓ dele, em segundo plano.
 *
 * Mocks, sem banco.
 */
describe('FacialService — cadastro de dispositivo', () => {
  const COND = 10;
  const base = { id_condominio: COND, nome: 'Facial 2', fabricante: 'intelbras', ip: '192.168.3.176' };

  /**
   * `online`: o agente já fez poll deste terminal? No cadastro real de um
   * terminal NOVO a resposta é sempre não (o heartbeat só chega no próximo
   * poll); o padrão `true` aqui serve aos testes de "a carga dispara".
   */
  function build(existentes: any[] = [], opts: { online?: boolean } = {}) {
    const linhas: any[] = existentes.map((d) => ({
      id_condominio: COND, ativo: 1, porta: 80, tipo: 'facial', sentido: 'auto',
      fabricante: 'intelbras', api_password: null, id_area_social: null, mac: null, ...d,
    }));
    const casa = (where: any, d: any) =>
      Object.entries(where ?? {}).every(([k, v]: [string, any]) =>
        v !== null && typeof v === 'object' && 'not' in v ? d[k] !== v.not : d[k] === v,
      );
    const prisma: any = {
      facial_Devices: {
        create: jest.fn(async ({ data }: any) => {
          const novo = { id: 100 + linhas.length, ativo: 1, ...data };
          linhas.push(novo);
          return novo;
        }),
        findFirst: jest.fn(async ({ where }: any) => linhas.find((d) => casa(where, d)) ?? null),
        findUnique: jest.fn(async ({ where }: any) => {
          const d = linhas.find((x) => x.id === where.id);
          return d ? { ...d } : null;
        }),
        update: jest.fn(async ({ where, data }: any) =>
          Object.assign(linhas.find((x) => x.id === where.id), data),
        ),
      },
      areas_Sociais: {
        findFirst: jest.fn(async () => ({ id: 7 })),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const agent: any = { isOnline: jest.fn(() => opts.online ?? true) };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, auditoria,
      null as any, agent, null as any, null as any, null as any,
    );
    const carga = jest
      .spyOn(svc, 'syncAllForCondominio')
      .mockResolvedValue({ total: 3, started: true } as any);
    const reconcile = jest.spyOn(svc, 'reconcileAreaGating').mockResolvedValue(undefined as any);
    return { svc, prisma, carga, reconcile, linhas };
  }

  /** Deixa as tarefas "fire-and-forget" rodarem. */
  const assentar = () => new Promise((r) => setImmediate(r));

  // ------------------------------------------------------------- validação
  describe('validação dos campos (400 com o nome do campo)', () => {
    it.each([
      ['nome ausente', { nome: undefined }, /nome/i],
      ['nome em branco', { nome: '   ' }, /nome/i],
      ['nome com mais de 100 caracteres', { nome: 'x'.repeat(101) }, /nome/i],
      ['tipo desconhecido', { tipo: 'geladeira' }, /tipo/i],
      ['sentido desconhecido', { sentido: 'ambos' }, /sentido/i],
      ['fabricante ausente', { fabricante: undefined }, /fabricante/i],
      ['fabricante em branco', { fabricante: '  ' }, /fabricante/i],
      ['fabricante com mais de 50 caracteres', { fabricante: 'f'.repeat(51) }, /fabricante/i],
      ['confiança mínima negativa', { confianca_minima: -1 }, /confian/i],
      ['confiança mínima acima de 100', { confianca_minima: 101 }, /confian/i],
      ['confiança mínima não numérica', { confianca_minima: 'alta' }, /confian/i],
    ])('create recusa %s', async (_nome, extra, mensagem) => {
      const { svc, prisma } = build();

      const p = svc.createDevice({ ...base, ...extra } as any);

      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow(mensagem);
      expect(prisma.facial_Devices.create).not.toHaveBeenCalled();
    });

    it.each([
      ['nome em branco', { nome: ' ' }, /nome/i],
      ['tipo desconhecido', { tipo: 'geladeira' }, /tipo/i],
      ['sentido desconhecido', { sentido: 'ambos' }, /sentido/i],
      ['fabricante em branco', { fabricante: '' }, /fabricante/i],
      ['confiança mínima acima de 100', { confianca_minima: 150 }, /confian/i],
    ])('update recusa %s', async (_nome, dto, mensagem) => {
      const { svc, prisma } = build([{ id: 1, nome: 'Facial 1', ip: '192.168.3.175' }]);

      const p = svc.updateDevice(1, dto as any);

      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow(mensagem);
      expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
    });

    it.each(['facial', 'botoeira', 'catraca', 'tag_reader', 'qrcode_reader', 'lpr'])(
      'create aceita o tipo %s',
      async (tipo) => {
        const { svc } = build();
        await expect(svc.createDevice({ ...base, tipo } as any)).resolves.toEqual(
          expect.objectContaining({ tipo }),
        );
      },
    );

    it.each(['auto', 'entrada', 'saida'])('create aceita o sentido %s', async (sentido) => {
      const { svc } = build();
      await expect(svc.createDevice({ ...base, sentido } as any)).resolves.toEqual(
        expect.objectContaining({ sentido }),
      );
    });

    it('grava nome e fabricante sem espaços nas pontas; fabricante fora da lista da tela segue aceito', async () => {
      const { svc, prisma } = build();

      await svc.createDevice({ ...base, nome: '  Portão  ', fabricante: ' genérico ' } as any);

      expect(prisma.facial_Devices.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ nome: 'Portão', fabricante: 'genérico' }),
      );
    });

    it('update não recusa o tipo antigo do próprio dispositivo quando a tela o reenvia', async () => {
      const { svc } = build([{ id: 1, nome: 'Relé antigo', ip: '192.168.3.175', tipo: 'rele' }]);

      await expect(svc.updateDevice(1, { tipo: 'rele', nome: 'Relé' } as any)).resolves.toEqual(
        expect.objectContaining({ nome: 'Relé' }),
      );
    });
  });

  // ------------------------------------------------------------- duplicado
  describe('duplicado', () => {
    const F1 = { id: 1, nome: 'Facial 1', ip: '192.168.3.175', porta: 80, mac: 'b4:4c:3b:f4:e3:01' };

    it('create recusa o mesmo ip:porta de um dispositivo ativo do condomínio', async () => {
      const { svc, prisma } = build([F1]);

      const p = svc.createDevice({ ...base, ip: '192.168.3.175' } as any);

      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow(/já existe o dispositivo "Facial 1" do tipo facial nesse endereço \(192\.168\.3\.175:80\)/i);
      expect(prisma.facial_Devices.create).not.toHaveBeenCalled();
    });

    it('create aceita o mesmo ip em OUTRA porta', async () => {
      const { svc } = build([F1]);
      await expect(svc.createDevice({ ...base, ip: '192.168.3.175', porta: 8080 } as any)).resolves.toBeDefined();
    });

    it('create aceita o endereço de um dispositivo DESATIVADO', async () => {
      const { svc } = build([{ ...F1, ativo: 0 }]);
      await expect(svc.createDevice({ ...base, ip: '192.168.3.175' } as any)).resolves.toBeDefined();
    });

    it('create aceita o endereço usado em OUTRO condomínio', async () => {
      const { svc } = build([{ ...F1, id_condominio: 99 }]);
      await expect(svc.createDevice({ ...base, ip: '192.168.3.175' } as any)).resolves.toBeDefined();
    });

    it('create recusa o mesmo MAC (em qualquer grafia) de um dispositivo ativo', async () => {
      const { svc } = build([F1]);

      await expect(
        svc.createDevice({ ...base, mac: 'B4-4C-3B-F4-E3-01' } as any),
      ).rejects.toThrow(/já existe o dispositivo "Facial 1" do tipo facial com esse MAC/i);
    });

    // O relé do próprio terminal facial, cadastrado como botoeira/catraca no
    // mesmo endereço, para um leitor de tag acioná-lo.
    it.each(['botoeira', 'catraca'])(
      'create ACEITA %s no mesmo ip:porta (e mesmo MAC) de um facial ativo',
      async (tipo) => {
        const { svc } = build([F1]);

        await expect(
          svc.createDevice({ ...base, nome: 'Relé do facial', tipo, ip: '192.168.3.175', mac: F1.mac } as any),
        ).resolves.toEqual(expect.objectContaining({ tipo, ip: '192.168.3.175', porta: 80 }));
      },
    );

    // Revisão 11/11: a regra vale só para FACIAL. Em leitor/abertura o IP não
    // identifica o aparelho: duas antenas (entrada e saída) da mesma
    // controladora têm o mesmo ip:porta (e MAC) e tokens diferentes.
    it('create ACEITA duas antenas tag_reader da mesma controladora (mesmo ip:porta e MAC)', async () => {
      const MAC = 'aa:bb:cc:dd:ee:01';
      const { svc } = build([
        F1,
        { id: 2, nome: 'Antena entrada', ip: '192.168.3.190', tipo: 'tag_reader', sentido: 'entrada', mac: MAC },
      ]);

      await expect(
        svc.createDevice({
          ...base, nome: 'Antena saída', tipo: 'tag_reader', sentido: 'saida', ip: '192.168.3.190', mac: MAC,
        } as any),
      ).resolves.toEqual(expect.objectContaining({ tipo: 'tag_reader', ip: '192.168.3.190' }));
    });

    it('create ACEITA a 2ª botoeira no mesmo ip:porta (dois relés da mesma placa)', async () => {
      const { svc } = build([F1, { id: 2, nome: 'Relé 1', ip: '192.168.3.175', tipo: 'botoeira' }]);

      await expect(
        svc.createDevice({ ...base, nome: 'Relé 2', tipo: 'botoeira', ip: '192.168.3.175' } as any),
      ).resolves.toEqual(expect.objectContaining({ nome: 'Relé 2' }));
    });

    it('update ACEITA mover um tag_reader para o ip:porta de outro tag_reader', async () => {
      const { svc } = build([
        { id: 2, nome: 'Antena 1', ip: '192.168.3.190', tipo: 'tag_reader' },
        { id: 3, nome: 'Antena 2', ip: '192.168.3.191', tipo: 'tag_reader' },
      ]);

      await expect(svc.updateDevice(3, { ip: '192.168.3.190' })).resolves.toEqual(
        expect.objectContaining({ ip: '192.168.3.190' }),
      );
    });

    // Simulador: o "IP" é um valor fixo ('sim'/'simulador'), não um endereço.
    it.each(['sim', 'simulador'])('create ACEITA dois faciais simuladores (ip %p)', async (ip) => {
      const { svc } = build([{ id: 1, nome: 'Simulador 1', ip }]);

      await expect(
        svc.createDevice({ ...base, nome: 'Simulador 2', ip } as any),
      ).resolves.toEqual(expect.objectContaining({ nome: 'Simulador 2', ip }));
    });

    it('update ACEITA trocar um facial para o ip de simulador já usado por outro', async () => {
      const { svc } = build([{ id: 1, nome: 'Simulador 1', ip: 'sim' }, { id: 2, nome: 'Facial 2', ip: '192.168.3.176' }]);

      await expect(svc.updateDevice(2, { ip: 'sim' })).resolves.toEqual(expect.objectContaining({ ip: 'sim' }));
    });

    it('create recusa o mesmo MAC só quando o tipo também é o mesmo', async () => {
      const { svc } = build([F1]);

      await expect(
        svc.createDevice({ ...base, tipo: 'tag_reader', mac: F1.mac } as any),
      ).resolves.toBeDefined();
      await expect(
        svc.createDevice({ ...base, ip: '192.168.3.177', tipo: 'facial', mac: F1.mac } as any),
      ).rejects.toThrow(/com esse MAC/i);
    });

    it('update ACEITA mover uma botoeira para o ip:porta de um facial', async () => {
      const { svc } = build([F1, { id: 2, nome: 'Relé', ip: '192.168.3.180', tipo: 'botoeira' }]);

      await expect(svc.updateDevice(2, { ip: '192.168.3.175' })).resolves.toEqual(
        expect.objectContaining({ ip: '192.168.3.175', tipo: 'botoeira' }),
      );
    });

    it('update recusa trocar o TIPO para o de outro dispositivo ativo no mesmo endereço', async () => {
      const { svc, prisma } = build([F1, { id: 2, nome: 'Relé', ip: '192.168.3.175', tipo: 'botoeira' }]);

      await expect(svc.updateDevice(2, { tipo: 'facial' } as any)).rejects.toThrow(
        /já existe o dispositivo "Facial 1" do tipo facial nesse endereço/i,
      );
      expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
    });

    it('update recusa mudar para o ip:porta de outro dispositivo ativo', async () => {
      const { svc, prisma } = build([F1, { id: 2, nome: 'Facial 2', ip: '192.168.3.176' }]);

      await expect(svc.updateDevice(2, { ip: '192.168.3.175' })).rejects.toThrow(
        /já existe o dispositivo "Facial 1" do tipo facial nesse endereço \(192\.168\.3\.175:80\)/i,
      );
      expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
    });

    it('update recusa REATIVAR um dispositivo cujo endereço já está em uso', async () => {
      const { svc } = build([F1, { id: 2, nome: 'Antigo', ip: '192.168.3.175', ativo: 0 }]);

      await expect(svc.updateDevice(2, { ativo: 1 })).rejects.toThrow(/já existe o dispositivo "Facial 1"/i);
    });

    it('update reenviando o próprio endereço (a tela manda o form inteiro) não é duplicado', async () => {
      const { svc } = build([F1]);
      await expect(
        svc.updateDevice(1, { nome: 'Facial A', ip: '192.168.3.175', porta: 80 }),
      ).resolves.toEqual(expect.objectContaining({ nome: 'Facial A' }));
    });

    it('update que não mexe em endereço não é barrado por duplicado ANTIGO', async () => {
      const { svc } = build([F1, { id: 2, nome: 'Gêmeo', ip: '192.168.3.175' }]);
      await expect(
        svc.updateDevice(2, { nome: 'Gêmeo 2', ip: '192.168.3.175', porta: 80 }),
      ).resolves.toEqual(expect.objectContaining({ nome: 'Gêmeo 2' }));
    });
  });

  // ------------------------------------------------- controle por reserva
  describe('controle_acesso_facial na criação', () => {
    it('ligado + área vinculada: liga na área e reconcilia', async () => {
      const { svc, prisma, reconcile } = build();

      await svc.createDevice({ ...base, id_area_social: 7, controle_acesso_facial: true } as any);

      expect(prisma.areas_Sociais.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { controle_acesso_facial: 1 },
      });
      expect(reconcile).toHaveBeenCalledWith(7);
    });

    it('desligado (padrão da tela) NÃO desliga o controle que a área já tinha', async () => {
      const { svc, prisma, reconcile } = build();

      await svc.createDevice({ ...base, id_area_social: 7, controle_acesso_facial: false } as any);

      expect(prisma.areas_Sociais.update).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
    });

    it('sem área vinculada não toca em área nenhuma', async () => {
      const { svc, prisma } = build();

      await svc.createDevice({ ...base, controle_acesso_facial: true } as any);

      expect(prisma.areas_Sociais.update).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------- carga do terminal novo
  describe('carga de rostos do terminal novo', () => {
    const F1 = { id: 1, nome: 'Facial 1', ip: '192.168.3.175' };

    it('criar o 2º facial com o terminal já online dispara a carga completa restrita a ele', async () => {
      const { svc, carga } = build([F1]);

      const novo = await svc.createDevice({ ...base } as any);
      await assentar();

      expect(carga).toHaveBeenCalledTimes(1);
      expect(carga).toHaveBeenCalledWith(COND, { deviceIds: [novo.id] });
    });

    // Revisão 11/11 — o caso REAL: terminal novo ainda não fez poll.
    describe('terminal OFFLINE: não inicia a carga, fica com carga pendente (ultima_sincr = null)', () => {
      const SINCRONIZADO = new Date('2026-11-01T10:00:00.000Z');

      it('criar o 2º facial NÃO inicia a carga; o registro nasce pendente', async () => {
        const { svc, carga, linhas } = build([F1], { online: false });

        const novo = await svc.createDevice({ ...base } as any);
        await assentar();

        expect(carga).not.toHaveBeenCalled();
        expect(linhas.find((d) => d.id === novo.id).ultima_sincr ?? null).toBeNull();
      });

      it('reativar um facial que já tinha recebido carga: não inicia e volta a pendente', async () => {
        const { svc, carga, linhas } = build([{ ...F1, ativo: 0, ultima_sincr: SINCRONIZADO }], { online: false });

        await svc.updateDevice(1, { ativo: 1 });
        await assentar();

        expect(carga).not.toHaveBeenCalled();
        expect(linhas[0].ultima_sincr).toBeNull();
      });

      it('trocar o ip (passou a ser outro aparelho): não inicia e volta a pendente', async () => {
        const { svc, carga, linhas } = build([{ ...F1, ultima_sincr: SINCRONIZADO }], { online: false });

        await svc.updateDevice(1, { ip: '192.168.3.200' });
        await assentar();

        expect(carga).not.toHaveBeenCalled();
        expect(linhas[0].ultima_sincr).toBeNull();
      });

      it('edição que não exige carga NÃO mexe em ultima_sincr', async () => {
        const { svc, linhas } = build([{ ...F1, ultima_sincr: SINCRONIZADO }], { online: false });

        await svc.updateDevice(1, { nome: 'Outro nome' });
        await assentar();

        expect(linhas[0].ultima_sincr).toEqual(SINCRONIZADO);
      });
    });

    it('terminal ONLINE que passou a ser outro aparelho: marca pendente e inicia a carga', async () => {
      const { svc, carga, linhas } = build([{ ...F1, ultima_sincr: new Date('2026-11-01T10:00:00.000Z') }]);

      await svc.updateDevice(1, { ip: '192.168.3.200' });
      await assentar();

      expect(linhas[0].ultima_sincr).toBeNull();
      expect(carga).toHaveBeenCalledWith(COND, { deviceIds: [1] });
    });

    // 6d
    it('trocar o TIPO para facial marca carga pendente (offline) / dispara a carga (online)', async () => {
      const LEITOR = { id: 2, nome: 'Era leitor', ip: '192.168.3.180', tipo: 'tag_reader', ultima_sincr: new Date() };
      const off = build([F1, { ...LEITOR }], { online: false });
      await off.svc.updateDevice(2, { tipo: 'facial' } as any);
      await assentar();
      expect(off.carga).not.toHaveBeenCalled();
      expect(off.linhas[1].ultima_sincr).toBeNull();

      const on = build([F1, { ...LEITOR }]);
      await on.svc.updateDevice(2, { tipo: 'facial' } as any);
      await assentar();
      expect(on.carga).toHaveBeenCalledWith(COND, { deviceIds: [2] });
    });

    it('trocar o tipo de facial PARA outro tipo não dispara carga', async () => {
      const { svc, carga } = build([F1]);

      await svc.updateDevice(1, { tipo: 'catraca' } as any);
      await assentar();

      expect(carga).not.toHaveBeenCalled();
    });

    it('criar leitor de tag NÃO dispara carga', async () => {
      const { svc, carga } = build([F1]);

      await svc.createDevice({ ...base, tipo: 'tag_reader' } as any);
      await assentar();

      expect(carga).not.toHaveBeenCalled();
    });

    it('falha na carga não quebra o cadastro', async () => {
      const { svc, carga } = build([F1]);
      carga.mockRejectedValue(new Error('agente fora'));

      await expect(svc.createDevice({ ...base } as any)).resolves.toEqual(
        expect.objectContaining({ nome: 'Facial 2' }),
      );
      await assentar();
    });

    it('a resposta do cadastro não espera a carga terminar', async () => {
      const { svc, carga } = build([F1]);
      carga.mockReturnValue(new Promise(() => undefined) as any);

      await expect(svc.createDevice({ ...base } as any)).resolves.toBeDefined();
    });

    it('reativar (ativo 0→1) um facial dispara a carga restrita a ele', async () => {
      const { svc, carga } = build([{ ...F1, ativo: 0 }]);

      await svc.updateDevice(1, { ativo: 1 });
      await assentar();

      expect(carga).toHaveBeenCalledWith(COND, { deviceIds: [1] });
    });

    it.each([
      ['ip', { ip: '192.168.3.200' }],
      ['porta', { porta: 8080 }],
      ['fabricante', { fabricante: 'hikvision' }],
    ])('trocar %s de um facial dispara a carga restrita a ele', async (_campo, dto) => {
      const { svc, carga } = build([F1]);

      await svc.updateDevice(1, dto as any);
      await assentar();

      expect(carga).toHaveBeenCalledTimes(1);
      expect(carga).toHaveBeenCalledWith(COND, { deviceIds: [1] });
    });

    it('edição que não muda endereço/fabricante/ativo NÃO dispara carga', async () => {
      const { svc, carga } = build([F1]);

      await svc.updateDevice(1, { nome: 'Outro nome', ip: '192.168.3.175', porta: 80, fabricante: 'intelbras', ativo: 1 });
      await assentar();

      expect(carga).not.toHaveBeenCalled();
    });

    it('desativar NÃO dispara carga; trocar ip de leitor de tag também não', async () => {
      const { svc, carga } = build([F1, { id: 2, nome: 'Leitor', ip: '192.168.3.180', tipo: 'tag_reader' }]);

      await svc.updateDevice(1, { ativo: 0 });
      await svc.updateDevice(2, { ip: '192.168.3.181' });
      await assentar();

      expect(carga).not.toHaveBeenCalled();
    });

    it('falha na carga não quebra a edição', async () => {
      const { svc, carga } = build([F1]);
      carga.mockRejectedValue(new Error('agente fora'));

      await expect(svc.updateDevice(1, { ip: '192.168.3.200' })).resolves.toBeDefined();
      await assentar();
    });
  });
});
