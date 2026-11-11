import { RelatoriosService } from './relatorios.service';
import {
  FiltroEspinha,
  montarSqlEspinha,
  montarSqlTotal,
  padraoLike,
  resolverPeriodoEventos,
} from './eventos-espinha';

/**
 * Log de Eventos paginado no banco ("espinha" + hidratação).
 *
 * Não há MySQL nos testes. Para não testar um dublê escrito à mão, o SQL
 * REAL gerado por `montarSqlEspinha`/`montarSqlTotal` é executado num SQLite
 * em memória (`node:sqlite`, Node >= 22.5). A única adaptação de dialeto é
 * `(col ± INTERVAL n SECOND)` -> `datetime(col, '±n seconds')`. Isso exercita
 * a lógica (união, filtros, deduplicação, ordem, limite), mas NÃO prova
 * sintaxe/colação/fuso/plano de execução do MySQL.
 */
let DatabaseSync: any;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = undefined;
}
if (!DatabaseSync) {
  // eslint-disable-next-line no-console
  console.warn('node:sqlite indisponível neste Node — testes de SQL do Log de Eventos PULADOS.');
}
const describeSql = DatabaseSync ? describe : describe.skip;

const AGORA = new Date('2026-11-10T15:00:00.000Z');
const txt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const atras = (ms: number) => new Date(AGORA.getTime() - ms);
const MIN = 60_000;
const DIA = 24 * 60 * MIN;

function paraSqlite(sql: { sql: string; values: unknown[] }) {
  return {
    texto: sql.sql.replace(
      /\(([\w.]+) ([-+]) INTERVAL (\d+) SECOND\)/g,
      (_m, col, sinal, n) => `datetime(${col}, '${sinal}${n} seconds')`,
    ),
    valores: sql.values.map((v) => (v instanceof Date ? txt(v) : v)),
  };
}

function criarBanco() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE pessoas (id INTEGER PRIMARY KEY, id_condominio INT, nome TEXT, doc_identificacao TEXT);
    CREATE TABLE visitas (id INTEGER PRIMARY KEY, id_pessoa INT, id_condominio INT, data_entrada TEXT, data_saida TEXT);
    CREATE TABLE Visitantes (id INTEGER PRIMARY KEY, id_condominio INT, nome TEXT, doc_identificacao TEXT, data_entrada TEXT, data_saida TEXT);
    CREATE TABLE Encomendas (id INTEGER PRIMARY KEY, id_condominio INT, descricao TEXT, destinatario_apto TEXT, recebido_de TEXT, recebido_em TEXT);
    CREATE TABLE Ocorrencias (id INTEGER PRIMARY KEY, id_condominio INT, descricao TEXT, created_at TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, id_condominio INT, modulo TEXT, descricao TEXT, created_at TEXT);
    CREATE TABLE Acessos_Facial (id INTEGER PRIMARY KEY, id_condominio INT, id_pessoa INT, tipo_pessoa TEXT, nome_pessoa TEXT, evento TEXT, timestamp TEXT);
  `);

  const t = {
    pessoas: [] as any[],
    visitas: [] as any[],
    visitantes: [] as any[],
    encomendas: [] as any[],
    ocorrencias: [] as any[],
    auditLog: [] as any[],
    acessos: [] as any[],
  };
  const d = (x: Date | null | undefined) => (x ? txt(x) : null);
  const ins = (sql: string, ...v: unknown[]) => db.prepare(sql).run(...(v as any[]));

  const banco = {
    pessoa(p: { id: number; nome: string; doc?: string; cond?: number }) {
      t.pessoas.push({ id: p.id, nome: p.nome, doc_identificacao: p.doc ?? null, foto_pessoa: 'rosto.jpg', foto_documento: 'rg.jpg', tipo_pessoa: 'visitante' });
      ins('INSERT INTO pessoas VALUES (?,?,?,?)', p.id, p.cond ?? 1, p.nome, p.doc ?? null);
    },
    visita(v: { id: number; idPessoa: number; entrada?: Date | null; saida?: Date | null; cond?: number }) {
      const pessoa = t.pessoas.find((p) => p.id === v.idPessoa);
      t.visitas.push({
        id: v.id, id_pessoa: v.idPessoa, id_condominio: v.cond ?? 1, is_prestador: 0,
        data_entrada: v.entrada ?? null, data_saida: v.saida ?? null,
        apartamento: { apto: '101', bloco: 'A' }, criadoPor: { name: 'Morador' }, pessoa,
      });
      ins('INSERT INTO visitas VALUES (?,?,?,?,?)', v.id, v.idPessoa, v.cond ?? 1, d(v.entrada), d(v.saida));
    },
    visitante(v: { id: number; nome: string; doc?: string; entrada?: Date | null; saida?: Date | null; cond?: number }) {
      t.visitantes.push({
        id: v.id, id_condominio: v.cond ?? 1, nome: v.nome, doc_identificacao: v.doc ?? null, is_prestador: 0,
        data_entrada: v.entrada ?? null, data_saida: v.saida ?? null, foto_pessoa: 'rosto.jpg', foto_documento: 'rg.jpg',
        apartamento: { apto: '101', bloco: 'A' }, criadoPor: { name: 'Morador' },
      });
      ins('INSERT INTO Visitantes VALUES (?,?,?,?,?,?)', v.id, v.cond ?? 1, v.nome, v.doc ?? null, d(v.entrada), d(v.saida));
    },
    encomenda(e: { id: number; quando: Date; descricao?: string; status?: string; cond?: number }) {
      t.encomendas.push({
        id: e.id, id_condominio: e.cond ?? 1, descricao: e.descricao ?? 'Caixa', destinatario_apto: '101', destinatario_bloco: 'A',
        recebido_de: null, recebido_em: e.quando, status: e.status ?? 'Aguardando', recebidoPor: null, entreguePor: null,
      });
      ins('INSERT INTO Encomendas VALUES (?,?,?,?,?,?)', e.id, e.cond ?? 1, e.descricao ?? 'Caixa', '101', null, d(e.quando));
    },
    ocorrencia(o: { id: number; quando: Date; descricao?: string; cond?: number }) {
      t.ocorrencias.push({
        id: o.id, id_condominio: o.cond ?? 1, descricao: o.descricao ?? 'Barulho', status: 'Pendente', created_at: o.quando,
        criadoPor: null, categoria: null, resposta: null, resposta_at: null,
      });
      ins('INSERT INTO Ocorrencias VALUES (?,?,?,?)', o.id, o.cond ?? 1, o.descricao ?? 'Barulho', d(o.quando));
    },
    audit(a: { id: number; quando: Date; modulo?: string; acao?: string; cond?: number }) {
      t.auditLog.push({
        id: a.id, id_condominio: a.cond ?? 1, modulo: a.modulo ?? 'dispositivos', acao: a.acao ?? 'OFFLINE',
        descricao: 'Terminal 1 ficou offline', created_at: a.quando, ip: '10.0.0.1',
      });
      ins('INSERT INTO audit_logs VALUES (?,?,?,?,?)', a.id, a.cond ?? 1, a.modulo ?? 'dispositivos', 'Terminal 1 ficou offline', d(a.quando));
    },
    facial(a: { id: number; quando: Date; idPessoa?: number | null; tipo?: string; evento?: string; nome?: string; cond?: number }) {
      t.acessos.push({
        id: a.id, id_condominio: a.cond ?? 1, id_pessoa: a.idPessoa ?? null, tipo_pessoa: a.tipo ?? 'morador',
        nome_pessoa: a.nome ?? 'Fulano', evento: a.evento ?? 'entrada', timestamp: a.quando,
        tipo_dispositivo: 'facial', confianca: 0.9, id_device: 1,
      });
      ins('INSERT INTO Acessos_Facial VALUES (?,?,?,?,?,?,?)', a.id, a.cond ?? 1, a.idPessoa ?? null, a.tipo ?? 'morador', a.nome ?? 'Fulano', a.evento ?? 'entrada', d(a.quando));
    },
  };

  const executar = (sql: any) => {
    const { texto, valores } = paraSqlite(sql);
    return db.prepare(texto).all(...valores) as any[];
  };

  const porId = (linhas: any[]) =>
    jest.fn(async (args: any) => {
      const ids: number[] | undefined = args?.where?.id?.in;
      return ids ? linhas.filter((l) => ids.includes(l.id)) : [...linhas];
    });

  const prisma: any = {
    isConnected: true,
    $queryRaw: jest.fn(async (sql: any) => executar(sql)),
    visitas: { findMany: porId(t.visitas) },
    pessoas: { findMany: porId(t.pessoas) },
    visitantes: { findMany: porId(t.visitantes) },
    encomendas: { findMany: porId(t.encomendas) },
    ocorrencias: { findMany: porId(t.ocorrencias) },
    auditLog: { findMany: porId(t.auditLog) },
    acessos_Facial: { findMany: porId(t.acessos) },
    moradores: { findMany: jest.fn(async () => []) },
    prestadores_servico: { findMany: jest.fn(async () => []) },
    facial_Devices: { findMany: jest.fn(async () => [{ id: 1, nome: 'Portão', ip: '10.0.0.9' }]) },
  };

  return { banco, prisma, t, executar, svc: new RelatoriosService(prisma) };
}

/** Linha do tempo densa: 6 fontes, com MUITOS empates de data (4 eventos por minuto). */
function povoar(b: ReturnType<typeof criarBanco>, migrado: boolean, n = 137) {
  let esperado = 0;
  for (let i = 0; i < n; i++) {
    const quando = atras(Math.floor(i / 4) * MIN + 5 * MIN);
    const id = i + 1;
    switch (i % 6) {
      case 0:
        if (migrado) {
          b.banco.pessoa({ id: 5000 + id, nome: `Pessoa ${id}`, doc: `DOC${id}` });
          b.banco.visita({ id, idPessoa: 5000 + id, entrada: quando, saida: i % 12 === 0 ? quando : null });
        } else {
          b.banco.visitante({ id, nome: `Pessoa ${id}`, doc: `DOC${id}`, entrada: quando, saida: i % 12 === 0 ? quando : null });
        }
        esperado += i % 12 === 0 ? 2 : 1;
        break;
      case 1: b.banco.encomenda({ id, quando }); esperado++; break;
      case 2: b.banco.ocorrencia({ id, quando }); esperado++; break;
      case 3: b.banco.audit({ id, quando, acao: i % 2 ? 'OFFLINE' : 'ONLINE' }); esperado++; break;
      default: b.banco.facial({ id, quando, idPessoa: 9000 + id, tipo: 'morador' }); esperado++; break;
    }
  }
  return esperado;
}

describeSql('RelatoriosService.getEventos() — paginação no banco', () => {
  const flagOriginal = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    jest.useFakeTimers({
      now: AGORA,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'performance', 'hrtime'],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    if (flagOriginal === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = flagOriginal;
  });

  describe.each([
    ['legado (Visitantes)', 'false'],
    ['migrado (visitas+pessoas)', 'true'],
  ])('caminho %s', (_nome, flag) => {
    it('percorrer todas as páginas não repete nem pula linha, e o total bate com a soma', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
      const b = criarBanco();
      const esperado = povoar(b, flag === 'true');

      const vistos: any[] = [];
      let total = -1;
      for (let page = 1; page <= 40; page++) {
        const r: any = await b.svc.getEventos(1, undefined, undefined, page, 10);
        if (total === -1) total = r.total;
        expect(r.total).toBe(total);
        expect(r.truncado).toBe(false);
        if (r.items.length === 0) break;
        expect(r.items.length).toBeLessThanOrEqual(10);
        vistos.push(...r.items);
      }

      expect(total).toBe(esperado);
      expect(vistos).toHaveLength(total);
      expect(new Set(vistos.map((i) => i.id)).size).toBe(total);
      // Data decrescente em toda a sequência.
      for (let i = 1; i < vistos.length; i++) {
        expect(vistos[i - 1].quando >= vistos[i].quando).toBe(true);
      }
      // E a sequência é a MESMA de uma leitura em página única (ordem estável).
      const unica: any = await b.svc.getEventos(1, undefined, undefined, 1, 200);
      expect(vistos.map((i) => i.id)).toEqual(unica.items.map((i: any) => i.id));
    });

    it('a hidratação só consulta os ids da página pedida', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
      const b = criarBanco();
      povoar(b, flag === 'true');

      const r: any = await b.svc.getEventos(1, undefined, undefined, 3, 7);
      expect(r.items).toHaveLength(7);
      const idsDaPagina = (prefixos: string[]) =>
        r.items
          .filter((i: any) => prefixos.some((p) => i.id.startsWith(p)))
          .map((i: any) => i.detalhes.id)
          .sort((x: number, y: number) => x - y);

      const conferir = (delegate: any, prefixos: string[]) => {
        const esperados = [...new Set<number>(idsDaPagina(prefixos))];
        if (esperados.length === 0) {
          expect(delegate.findMany).not.toHaveBeenCalled();
          return;
        }
        expect(delegate.findMany).toHaveBeenCalledTimes(1);
        const where = delegate.findMany.mock.calls[0][0].where;
        expect([...where.id.in].sort((x: number, y: number) => x - y)).toEqual(esperados);
        expect(where.id_condominio).toBe(1);
        expect(delegate.findMany.mock.calls[0][0]).not.toHaveProperty('take');
      };

      const visitaDelegate = flag === 'true' ? b.prisma.visitas : b.prisma.visitantes;
      const outroDelegate = flag === 'true' ? b.prisma.visitantes : b.prisma.visitas;
      conferir(visitaDelegate, ['visitante-ent-', 'visitante-sai-']);
      expect(outroDelegate.findMany).not.toHaveBeenCalled();
      conferir(b.prisma.encomendas, ['encomenda-']);
      conferir(b.prisma.ocorrencias, ['ocorrencia-']);
      conferir(b.prisma.auditLog, ['dispositivo-']);
      conferir(b.prisma.acessos_Facial, ['facial-access-']);
      // Duas consultas cruas por página: espinha + contagem.
      expect(b.prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  it('página além do fim: vazia, total preservado, nenhuma hidratação', async () => {
    const b = criarBanco();
    const esperado = povoar(b, false, 20);
    const r: any = await b.svc.getEventos(1, undefined, undefined, 99, 10);
    expect(r.items).toEqual([]);
    expect(r.total).toBe(esperado);
    expect(b.prisma.visitantes.findMany).not.toHaveBeenCalled();
    expect(b.prisma.encomendas.findMany).not.toHaveBeenCalled();
  });

  it('não vaza evento de outro condomínio', async () => {
    const b = criarBanco();
    b.banco.encomenda({ id: 1, quando: atras(MIN) });
    b.banco.encomenda({ id: 2, quando: atras(MIN), cond: 2 });
    b.banco.audit({ id: 3, quando: atras(MIN), cond: 2 });
    b.banco.audit({ id: 4, quando: atras(MIN), modulo: 'visitantes' });
    const r: any = await b.svc.getEventos(1);
    expect(r.items.map((i: any) => i.id)).toEqual(['encomenda-1']);
    expect(r.total).toBe(1);
  });

  it('empate de data: desempate determinístico por fonte e depois id desc', async () => {
    const b = criarBanco();
    const q = atras(10 * MIN);
    b.banco.facial({ id: 2, quando: q });
    b.banco.facial({ id: 9, quando: q });
    b.banco.ocorrencia({ id: 4, quando: q });
    b.banco.encomenda({ id: 3, quando: q });
    b.banco.encomenda({ id: 8, quando: q });
    b.banco.audit({ id: 6, quando: q });
    b.banco.visitante({ id: 5, nome: 'Ana', entrada: q, saida: q });
    const esperada = [
      'visitante-ent-5', 'visitante-sai-5', 'encomenda-8', 'encomenda-3',
      'ocorrencia-4', 'dispositivo-6', 'facial-access-9', 'facial-access-2',
    ];
    const r: any = await b.svc.getEventos(1);
    expect(r.items.map((i: any) => i.id)).toEqual(esperada);
    // Fatiado de 3 em 3 dá a mesma ordem.
    const fatiado: string[] = [];
    for (let p = 1; p <= 3; p++) {
      const pg: any = await b.svc.getEventos(1, undefined, undefined, p, 3);
      fatiado.push(...pg.items.map((i: any) => i.id));
    }
    expect(fatiado).toEqual(esperada);
  });

  describe('deduplicação manual x facial', () => {
    const q = atras(60 * MIN);
    const mais = (s: number) => new Date(q.getTime() + s * 1000);

    it('legado: facial da mesma pessoa a 10 s some com a entrada manual (lista e total)', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const b = criarBanco();
      b.banco.visitante({ id: 30, nome: 'Maria', entrada: q });
      b.banco.facial({ id: 1, quando: mais(10), idPessoa: 30, tipo: 'visitante', evento: 'entrada', nome: 'Maria' });
      const r: any = await b.svc.getEventos(1);
      expect(r.items.map((i: any) => i.id)).toEqual(['facial-access-1']);
      expect(r.total).toBe(1);
    });

    it('janela é de 15 s para cada lado (inclusive): 15 s deduplica, 16 s não', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const b = criarBanco();
      b.banco.visitante({ id: 30, nome: 'Maria', entrada: q });
      b.banco.visitante({ id: 31, nome: 'Joana', entrada: q });
      b.banco.visitante({ id: 32, nome: 'Carla', entrada: q });
      b.banco.facial({ id: 1, quando: mais(-15), idPessoa: 30, tipo: 'visitante', nome: 'Maria' });
      b.banco.facial({ id: 2, quando: mais(16), idPessoa: 31, tipo: 'prestador', nome: 'Joana' });
      b.banco.facial({ id: 3, quando: mais(-16), idPessoa: 32, tipo: 'visitante', nome: 'Carla' });
      const r: any = await b.svc.getEventos(1);
      const ids = r.items.map((i: any) => i.id);
      expect(ids).not.toContain('visitante-ent-30');
      expect(ids).toContain('visitante-ent-31');
      expect(ids).toContain('visitante-ent-32');
      expect(r.total).toBe(5);
    });

    it('não deduplica contra evento de outro tipo, de morador, de outra pessoa ou de outro condomínio', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const b = criarBanco();
      b.banco.visitante({ id: 30, nome: 'Maria', entrada: q, saida: mais(3600) });
      b.banco.facial({ id: 1, quando: q, idPessoa: 30, tipo: 'visitante', evento: 'saida' });
      b.banco.facial({ id: 2, quando: q, idPessoa: 30, tipo: 'morador', evento: 'entrada' });
      b.banco.facial({ id: 3, quando: q, idPessoa: 31, tipo: 'visitante', evento: 'entrada' });
      b.banco.facial({ id: 4, quando: q, idPessoa: 30, tipo: 'visitante', evento: 'entrada', cond: 2 });
      b.banco.facial({ id: 5, quando: q, idPessoa: 30, tipo: 'visitante', evento: 'negado' });
      const r: any = await b.svc.getEventos(1);
      const ids = r.items.map((i: any) => i.id);
      expect(ids).toContain('visitante-ent-30');
      expect(ids).toContain('visitante-sai-30');
      expect(r.total).toBe(6);
    });

    it('saída manual também deduplica contra facial de saída', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const b = criarBanco();
      b.banco.visitante({ id: 30, nome: 'Maria', entrada: q, saida: mais(3600) });
      b.banco.facial({ id: 1, quando: mais(3605), idPessoa: 30, tipo: 'visitante', evento: 'saida' });
      const r: any = await b.svc.getEventos(1);
      expect(r.items.map((i: any) => i.id)).toEqual(['facial-access-1', 'visitante-ent-30']);
      expect(r.total).toBe(2);
    });

    it('migrado: facial gravado com o id da VISITA deduplica', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const b = criarBanco();
      b.banco.pessoa({ id: 700, nome: 'Maria' });
      b.banco.visita({ id: 300, idPessoa: 700, entrada: q });
      b.banco.facial({ id: 1, quando: mais(5), idPessoa: 300, tipo: 'visitante', nome: 'Maria' });
      const r: any = await b.svc.getEventos(1);
      expect(r.items.map((i: any) => i.id)).toEqual(['facial-access-1']);
      expect(r.total).toBe(1);
    });

    it('migrado: facial gravado com o id da PESSOA (segundo espaço de id) também deduplica', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const b = criarBanco();
      b.banco.pessoa({ id: 700, nome: 'Maria' });
      b.banco.visita({ id: 300, idPessoa: 700, entrada: q });
      b.banco.facial({ id: 1, quando: mais(5), idPessoa: 700, tipo: 'visitante', nome: 'Maria' });
      const r: any = await b.svc.getEventos(1);
      expect(r.items.map((i: any) => i.id)).toEqual(['facial-access-1']);
      expect(r.total).toBe(1);
    });

    it('o facial só substitui o manual se ele mesmo está no resultado (período e busca)', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const b = criarBanco();
      // Manual 23:59:55 (-03:00) de 01/11; facial 00:00:05 de 02/11.
      const manual = new Date('2026-11-02T02:59:55.000Z');
      b.banco.visitante({ id: 30, nome: 'Maria', doc: '12345', entrada: manual });
      b.banco.facial({ id: 1, quando: new Date('2026-11-02T03:00:05.000Z'), idPessoa: 30, tipo: 'visitante', nome: 'MARIA S' });

      // Período que pega os dois: fica só o facial.
      let r: any = await b.svc.getEventos(1, '2026-11-01', '2026-11-02');
      expect(r.items.map((i: any) => i.id)).toEqual(['facial-access-1']);
      // Período só do dia 01: o facial está fora, então o manual NÃO pode sumir.
      r = await b.svc.getEventos(1, '2026-11-01', '2026-11-01');
      expect(r.items.map((i: any) => i.id)).toEqual(['visitante-ent-30']);
      expect(r.total).toBe(1);
      // Busca pelo documento: o facial não casa (só tem nome), o manual fica.
      r = await b.svc.getEventos(1, '2026-11-01', '2026-11-02', 1, 50, '12345');
      expect(r.items.map((i: any) => i.id)).toEqual(['visitante-ent-30']);
      expect(r.total).toBe(1);
      // Busca pelo nome: os dois casam, fica o facial.
      r = await b.svc.getEventos(1, '2026-11-01', '2026-11-02', 1, 50, 'maria');
      expect(r.items.map((i: any) => i.id)).toEqual(['facial-access-1']);
      expect(r.total).toBe(1);
    });

    it('com deduplicação no meio, as páginas continuam somando o total', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const b = criarBanco();
      for (let i = 1; i <= 30; i++) {
        const quando = atras(i * MIN);
        b.banco.pessoa({ id: 1000 + i, nome: `P${i}` });
        b.banco.visita({ id: i, idPessoa: 1000 + i, entrada: quando });
        // Um terço tem o par facial (alternando o espaço de id).
        if (i % 3 === 0) {
          b.banco.facial({ id: i, quando, idPessoa: i % 2 ? i : 1000 + i, tipo: 'visitante', nome: `P${i}` });
        }
      }
      const vistos: string[] = [];
      let total = 0;
      for (let p = 1; p <= 10; p++) {
        const r: any = await b.svc.getEventos(1, undefined, undefined, p, 4);
        total = r.total;
        vistos.push(...r.items.map((i: any) => i.id));
      }
      expect(total).toBe(30);
      expect(vistos).toHaveLength(30);
      expect(new Set(vistos).size).toBe(30);
      expect(vistos.filter((i) => i.startsWith('facial-access-'))).toHaveLength(10);
    });
  });

  describe('período', () => {
    it('sem datas: cobre os últimos 30 dias e informa o período aplicado', async () => {
      const b = criarBanco();
      b.banco.encomenda({ id: 1, quando: atras(5 * DIA) });
      b.banco.encomenda({ id: 2, quando: atras(40 * DIA) });
      b.banco.ocorrencia({ id: 3, quando: atras(31 * DIA) });
      // Primeiro instante do período: 11/10 00:00 (-03:00).
      b.banco.ocorrencia({ id: 4, quando: new Date('2026-10-11T03:00:00.000Z') });
      b.banco.ocorrencia({ id: 5, quando: new Date('2026-10-11T02:59:59.000Z') });
      const r: any = await b.svc.getEventos(1);
      expect(r.periodo).toEqual({ dataInicio: '2026-10-11', dataFim: '2026-11-10', padrao: true });
      expect(r.items.map((i: any) => i.id)).toEqual(['encomenda-1', 'ocorrencia-4']);
      expect(r.total).toBe(2);
    });

    it('com período explícito vale o informado (inclusive mais antigo que 30 dias)', async () => {
      const b = criarBanco();
      b.banco.encomenda({ id: 1, quando: atras(5 * DIA) });
      b.banco.encomenda({ id: 2, quando: atras(40 * DIA) });
      const r: any = await b.svc.getEventos(1, '2026-09-01', '2026-10-15');
      expect(r.periodo).toEqual({ dataInicio: '2026-09-01', dataFim: '2026-10-15', padrao: false });
      expect(r.items.map((i: any) => i.id)).toEqual(['encomenda-2']);
    });

    it('só dataInicio: fim aberto; só dataFim: início aberto', async () => {
      const b = criarBanco();
      b.banco.encomenda({ id: 1, quando: atras(5 * DIA) });
      b.banco.encomenda({ id: 2, quando: atras(400 * DIA) });
      let r: any = await b.svc.getEventos(1, '2020-01-01');
      expect(r.periodo).toEqual({ dataInicio: '2020-01-01', dataFim: null, padrao: false });
      expect(r.total).toBe(2);
      r = await b.svc.getEventos(1, undefined, '2026-01-01');
      expect(r.periodo).toEqual({ dataInicio: null, dataFim: '2026-01-01', padrao: false });
      expect(r.items.map((i: any) => i.id)).toEqual(['encomenda-2']);
    });

    it('limites do dia no fuso -03:00 (00:00:00 entra, 23:59:59 entra, 00:00:00 do dia seguinte não)', async () => {
      const b = criarBanco();
      b.banco.ocorrencia({ id: 1, quando: new Date('2026-10-01T03:00:00.000Z') });
      b.banco.ocorrencia({ id: 2, quando: new Date('2026-10-02T02:59:59.000Z') });
      b.banco.ocorrencia({ id: 3, quando: new Date('2026-10-02T03:00:00.000Z') });
      b.banco.ocorrencia({ id: 4, quando: new Date('2026-10-01T02:59:59.000Z') });
      const r: any = await b.svc.getEventos(1, '2026-10-01', '2026-10-01');
      expect(r.items.map((i: any) => i.id)).toEqual(['ocorrencia-2', 'ocorrencia-1']);
    });

    it('sem banco: devolve vazio, truncado false e o período', async () => {
      const b = criarBanco();
      b.prisma.isConnected = false;
      const r: any = await b.svc.getEventos(1);
      expect(r).toMatchObject({ items: [], total: 0, truncado: false });
      expect(r.periodo).toEqual({ dataInicio: '2026-10-11', dataFim: '2026-11-10', padrao: true });
      expect(b.prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('busca', () => {
    it('filtra cada fonte pelos mesmos campos de antes', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const b = criarBanco();
      const q = atras(MIN);
      b.banco.pessoa({ id: 700, nome: 'Zuleica Prado', doc: '99911' });
      b.banco.visita({ id: 1, idPessoa: 700, entrada: q });
      b.banco.pessoa({ id: 701, nome: 'Outro', doc: '555' });
      b.banco.visita({ id: 2, idPessoa: 701, entrada: q });
      b.banco.encomenda({ id: 3, quando: q, descricao: 'Pacote da Zuleica' });
      b.banco.encomenda({ id: 4, quando: q, descricao: 'Caixa' });
      b.banco.ocorrencia({ id: 5, quando: q, descricao: 'zuleica reclamou' });
      b.banco.facial({ id: 6, quando: q, nome: 'ZULEICA PRADO', idPessoa: 1, tipo: 'morador' });
      b.banco.facial({ id: 7, quando: q, nome: 'Beltrano' });
      b.banco.audit({ id: 8, quando: q });

      let r: any = await b.svc.getEventos(1, undefined, undefined, 1, 50, 'zuleica');
      expect(r.items.map((i: any) => i.id).sort()).toEqual(
        ['encomenda-3', 'facial-access-6', 'ocorrencia-5', 'visitante-ent-1'].sort(),
      );
      expect(r.total).toBe(4);

      r = await b.svc.getEventos(1, undefined, undefined, 1, 50, '99911');
      expect(r.items.map((i: any) => i.id)).toEqual(['visitante-ent-1']);
    });

    it('curingas digitados pelo usuário são literais', async () => {
      const b = criarBanco();
      b.banco.encomenda({ id: 1, quando: atras(MIN), descricao: 'Desconto 50% off' });
      b.banco.encomenda({ id: 2, quando: atras(MIN), descricao: 'Caixa' });
      let r: any = await b.svc.getEventos(1, undefined, undefined, 1, 50, '%');
      expect(r.items.map((i: any) => i.id)).toEqual(['encomenda-1']);
      r = await b.svc.getEventos(1, undefined, undefined, 1, 50, '_');
      expect(r.items).toEqual([]);
    });
  });

  it('contrato do item preservado nas 6 fontes', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const b = criarBanco();
    const q = atras(MIN);
    b.banco.pessoa({ id: 700, nome: 'Maria' });
    b.banco.visita({ id: 1, idPessoa: 700, entrada: q, saida: q });
    b.banco.encomenda({ id: 2, quando: q, status: 'Esperando' });
    b.banco.ocorrencia({ id: 3, quando: q });
    b.banco.audit({ id: 4, quando: q, acao: 'OFFLINE' });
    b.banco.audit({ id: 5, quando: q, acao: 'ONLINE' });
    b.banco.facial({ id: 6, quando: q });
    const r: any = await b.svc.getEventos(1);
    expect(r.items).toHaveLength(7);
    for (const item of r.items) {
      expect(item).toEqual(expect.objectContaining({
        id: expect.any(String), tipo: expect.any(String), descricao: expect.any(String),
        quando: q.toISOString(), detalhes: expect.any(Object),
      }));
      expect(JSON.stringify(item)).not.toContain('rg.jpg');
    }
    const por = (id: string) => r.items.find((i: any) => i.id === id);
    expect(por('visitante-ent-1')).toMatchObject({ tipo: 'Visitante', direcao: 'entrada', descricao: 'Maria entrou — Apto 101 · Bloco A' });
    expect(por('visitante-sai-1')).toMatchObject({ direcao: 'saida', detalhes: { status: 'Saiu', fotoPessoa: 'rosto.jpg' } });
    expect(por('encomenda-2').detalhes.dataEntrada).toBeNull();
    expect(por('dispositivo-4')).toMatchObject({ direcao: 'offline', detalhes: { status: 'Offline' } });
    expect(por('dispositivo-5')).toMatchObject({ direcao: 'online', detalhes: { status: 'Resolvido' } });
    expect(por('facial-access-6')).toMatchObject({ tipo: 'Acesso Facial', direcao: 'entrada', detalhes: { terminalNome: 'Portão', terminalIp: '10.0.0.9' } });
    expect(r).toMatchObject({ page: 1, pageSize: 50, total: 7, truncado: false });
  });
});

describe('eventos-espinha — montagem do SQL', () => {
  const base: FiltroEspinha = {
    idCondominio: 7,
    inicio: new Date('2026-10-01T03:00:00.000Z'),
    fimExclusivo: new Date('2026-11-01T03:00:00.000Z'),
    search: "x' OR 1=1 --",
    migrado: true,
    limit: 25,
    offset: 50,
  };

  it('busca, datas e paginação entram como parâmetros, nunca no texto', () => {
    for (const sql of [montarSqlEspinha(base), montarSqlTotal(base)]) {
      expect(sql.sql).not.toContain('OR 1=1');
      expect(sql.sql).not.toContain('2026-');
      expect(sql.values).toContain("%x' OR 1=1 --%");
      expect(sql.values).toContain(base.inicio);
      expect(sql.values).toContain(base.fimExclusivo);
      // Nenhum literal numérico do filtro no texto.
      expect(sql.sql).not.toMatch(/id_condominio = 7/);
    }
  });

  it('LIMIT/OFFSET finais vêm do filtro e cada fonte é limitada a offset+limit', () => {
    const sql = montarSqlEspinha(base);
    expect(sql.sql.trim()).toMatch(/ORDER BY u\.quando DESC, u\.ord ASC, u\.id DESC\s+LIMIT \? OFFSET \?$/);
    expect(sql.values.slice(-2)).toEqual([25, 50]);
    expect(sql.values.filter((v) => v === 75)).toHaveLength(6);
    expect(sql.sql.match(/UNION ALL/g)).toHaveLength(5);
  });

  it('migrado lê visitas+pessoas; legado lê Visitantes — nunca os dois', () => {
    const on = montarSqlEspinha(base).sql + montarSqlTotal(base).sql;
    expect(on).toMatch(/FROM visitas v/);
    expect(on).toMatch(/JOIN pessoas p ON p\.id = v\.id_pessoa/);
    expect(on).not.toMatch(/Visitantes/);
    expect(on).toMatch(/af\.id_pessoa IN \(v\.id, v\.id_pessoa\)/);

    const legado = { ...base, migrado: false };
    const off = montarSqlEspinha(legado).sql + montarSqlTotal(legado).sql;
    expect(off).toMatch(/FROM Visitantes v/);
    expect(off).not.toMatch(/\bvisitas\b|\bpessoas\b/);
    expect(off).toMatch(/af\.id_pessoa IN \(v\.id\)/);
  });

  it('usa os nomes físicos das tabelas do schema', () => {
    const sql = montarSqlEspinha({ ...base, migrado: false }).sql;
    for (const tabela of ['FROM Visitantes v', 'FROM Encomendas e', 'FROM Ocorrencias o', 'FROM audit_logs a', 'FROM Acessos_Facial af']) {
      expect(sql).toContain(tabela);
    }
    expect(sql).toContain("a.modulo = 'dispositivos'");
  });

  it('sem busca não faz JOIN em pessoas nem LIKE', () => {
    const sql = montarSqlEspinha({ ...base, search: undefined }).sql;
    expect(sql).not.toMatch(/LIKE|JOIN pessoas/);
  });

  it('padraoLike escapa curingas e ignora vazio', () => {
    expect(padraoLike('50%_!')).toBe('%50!%!_!!%');
    expect(padraoLike('  ')).toBeNull();
    expect(padraoLike(undefined)).toBeNull();
  });
});

describe('resolverPeriodoEventos', () => {
  it('padrão: hoje-30 até hoje, com "hoje" no fuso -03:00', () => {
    // 01:00 UTC do dia 10 ainda é dia 09 em -03:00.
    const p = resolverPeriodoEventos(undefined, undefined, new Date('2026-11-10T01:00:00.000Z'));
    expect(p).toMatchObject({ dataInicio: '2026-10-10', dataFim: '2026-11-09', padrao: true });
    expect(p.inicio?.toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(p.fimExclusivo?.toISOString()).toBe('2026-11-10T03:00:00.000Z');
  });

  it('explícito: respeita o informado e deixa aberto o lado omitido', () => {
    const p = resolverPeriodoEventos('2026-01-05', undefined, AGORA);
    expect(p).toMatchObject({ dataInicio: '2026-01-05', dataFim: null, padrao: false, fimExclusivo: null });
    expect(p.inicio?.toISOString()).toBe('2026-01-05T03:00:00.000Z');
    const q = resolverPeriodoEventos(undefined, '2026-01-05', AGORA);
    expect(q).toMatchObject({ dataInicio: null, inicio: null, padrao: false });
    expect(q.fimExclusivo?.toISOString()).toBe('2026-01-06T03:00:00.000Z');
  });
});
