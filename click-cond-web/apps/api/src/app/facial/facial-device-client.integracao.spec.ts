import * as http from 'http';
import * as crypto from 'crypto';
import {
  FacialDeviceClientService,
  FacialDeviceConfig,
} from './facial-device-client.service';

/**
 * Modo DIRETO do cliente (agente offline) contra um aparelho simulado que fala
 * os protocolos de verdade: Hikvision ISAPI com Digest e Control iD .fcgi com
 * sessão. Sobe um servidor HTTP em 127.0.0.1 — sem hardware e sem rede externa.
 *
 * Por que existe: o modo direto é uma SEGUNDA implementação dos mesmos
 * protocolos (a primeira é o Agente Local). Todo o resto da suíte usa mocks, o
 * que não pega erro de protocolo — header Digest mal montado, multipart
 * inválido, sessão não enviada. Aqui o servidor recusa se algo disso estiver
 * errado.
 */

const USER = 'admin';
const PASS = 'senha123';
const REALM = 'DS-K1T671M';
const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

interface EstadoAparelho {
  usuariosHik: Map<string, any>;
  rostosHik: Map<string, number>;
  usuariosCid: Map<string, any>;
  rostosCid: Map<string, number>;
  portaAberta: number;
  digestValidado: number;
  proximoIdCid: number;
  sessoes: Set<string>;
}

function novoEstado(): EstadoAparelho {
  return {
    usuariosHik: new Map(),
    rostosHik: new Map(),
    usuariosCid: new Map(),
    rostosCid: new Map(),
    portaAberta: 0,
    digestValidado: 0,
    proximoIdCid: 100,
    sessoes: new Set(),
  };
}

/** Valida o Digest de verdade: header mal montado ou senha errada não passa. */
function digestOk(req: http.IncomingMessage, estado: EstadoAparelho): boolean {
  const auth = req.headers.authorization || '';
  if (!/^Digest /i.test(auth)) return false;
  const campo = (k: string) => {
    const m = auth.match(new RegExp(`${k}="?([^",]+)"?`, 'i'));
    return m ? m[1] : '';
  };
  if (campo('uri') !== req.url) return false;
  const ha1 = md5(`${USER}:${campo('realm')}:${PASS}`);
  const ha2 = md5(`${req.method}:${campo('uri')}`);
  const qop = campo('qop');
  const esperado = qop
    ? md5(`${ha1}:${campo('nonce')}:${campo('nc')}:${campo('cnonce')}:${qop}:${ha2}`)
    : md5(`${ha1}:${campo('nonce')}:${ha2}`);
  if (esperado !== campo('response')) return false;
  estado.digestValidado++;
  return true;
}

function subirAparelho(estado: EstadoAparelho): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://x');
      const caminho = url.pathname;
      const json = (obj: unknown, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const parse = () => {
        try {
          return JSON.parse(body.toString('utf8'));
        } catch {
          return {} as any;
        }
      };

      // ----- Control iD: sessão na query, sem auth por header -----
      if (caminho.endsWith('.fcgi')) {
        const session = url.searchParams.get('session');
        if (caminho === '/login.fcgi') {
          const { login, password } = parse();
          if (login !== USER || password !== PASS) return json({ error: 'auth' }, 401);
          const s = crypto.randomBytes(6).toString('hex');
          estado.sessoes.add(s);
          return json({ session: s });
        }
        if (!session || !estado.sessoes.has(session)) {
          return json({ error: 'sessao invalida' }, 401);
        }
        if (caminho === '/create_objects.fcgi') {
          const { values } = parse();
          const ids = values.map((v: any) => {
            const id = estado.proximoIdCid++;
            estado.usuariosCid.set(String(id), v);
            return id;
          });
          return json({ ids });
        }
        if (caminho === '/user_set_image.fcgi') {
          const userId = String(url.searchParams.get('user_id'));
          if (!estado.usuariosCid.has(userId)) return json({ error: 'inexistente' }, 400);
          if (body.length < 100) return json({ error: 'imagem vazia' }, 400);
          estado.rostosCid.set(userId, body.length);
          return json({ success: true });
        }
        if (caminho === '/modify_objects.fcgi') {
          const { values, where } = parse();
          const id = String(where?.users?.id);
          const atual = estado.usuariosCid.get(id);
          if (!atual) return json({ error: 'inexistente' }, 400);
          estado.usuariosCid.set(id, { ...atual, ...values });
          return json({ changes: 1 });
        }
        if (caminho === '/destroy_objects.fcgi') {
          const { where } = parse();
          estado.usuariosCid.delete(String(where?.users?.id));
          return json({ changes: 1 });
        }
        if (caminho === '/execute_actions.fcgi') {
          estado.portaAberta++;
          return json({ success: true });
        }
        if (caminho === '/load_objects.fcgi') {
          return json({
            users: [...estado.usuariosCid.entries()].map(([id, v]) => ({
              id: Number(id),
              ...v,
            })),
          });
        }
        res.writeHead(404);
        return res.end();
      }

      // ----- Hikvision: tudo exige Digest -----
      if (!digestOk(req, estado)) {
        res.writeHead(401, {
          'WWW-Authenticate': `Digest realm="${REALM}", nonce="${crypto
            .randomBytes(8)
            .toString('hex')}", qop="auth"`,
        });
        return res.end('unauthorized');
      }

      if (caminho === '/ISAPI/System/deviceInfo') {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end('<DeviceInfo><model>DS-K1T671M</model></DeviceInfo>');
      }
      if (caminho === '/ISAPI/AccessControl/RemoteControl/door/1') {
        estado.portaAberta++;
        return json({ statusCode: 1 });
      }
      if (caminho === '/ISAPI/AccessControl/UserInfo/Record') {
        const info = parse().UserInfo?.[0];
        // Aparelho real recusa duplicado — força o cliente a cair no Modify.
        if (estado.usuariosHik.has(String(info?.employeeNo))) {
          return json({ statusString: 'Error: duplicate' }, 400);
        }
        estado.usuariosHik.set(String(info.employeeNo), info);
        return json({ statusCode: 1 });
      }
      if (caminho === '/ISAPI/AccessControl/UserInfo/Modify') {
        const info = parse().UserInfo?.[0];
        estado.usuariosHik.set(String(info.employeeNo), info);
        return json({ statusCode: 1 });
      }
      if (caminho === '/ISAPI/AccessControl/UserInfo/Delete') {
        for (const e of parse().UserInfoDelCond?.EmployeeNoList ?? []) {
          estado.usuariosHik.delete(String(e.employeeNo));
        }
        return json({ statusCode: 1 });
      }
      if (caminho === '/ISAPI/Intelligent/FDLib/FDSetUp') {
        for (const f of parse().FPID ?? []) estado.rostosHik.delete(String(f.value));
        return json({ statusCode: 1 });
      }
      if (caminho === '/ISAPI/Intelligent/FDLib/FaceDataRecord') {
        const ct = req.headers['content-type'] || '';
        const m = ct.match(/boundary=(.+)$/);
        if (!m) return json({ statusString: 'Error: sem boundary' }, 400);
        const texto = body.toString('binary');
        const partes = texto.split('--' + m[1]);
        const parteJson = partes.find((p) => p.includes('FaceDataRecord'));
        const parteImg = partes.find((p) => p.includes('filename='));
        if (!parteJson || !parteImg) {
          return json({ statusString: 'Error: multipart incompleto' }, 400);
        }
        const corpo = parteJson.slice(parteJson.indexOf('{'));
        const fpid = JSON.parse(corpo.slice(0, corpo.lastIndexOf('}') + 1)).FPID;
        const bytes = parteImg.slice(parteImg.indexOf('\r\n\r\n') + 4).length;
        if (bytes < 100) return json({ statusString: 'Error: imagem vazia' }, 400);
        estado.rostosHik.set(String(fpid), bytes);
        return json({ statusCode: 1 });
      }
      if (caminho === '/ISAPI/AccessControl/UserInfo/Search') {
        const cond = parse().UserInfoSearchCond ?? {};
        const pos = Number(cond.searchResultPosition ?? 0);
        const max = Number(cond.maxResults ?? 50);
        const todos = [...estado.usuariosHik.keys()];
        const pagina = todos.slice(pos, pos + max);
        return json({
          UserInfoSearch: {
            responseStatusStrg: pos + pagina.length < todos.length ? 'MORE' : 'OK',
            UserInfo: pagina.map((employeeNo) => ({ employeeNo })),
          },
        });
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server)),
  );
}

describe('FacialDeviceClientService — modo direto contra aparelho simulado', () => {
  let server: http.Server;
  let estado: EstadoAparelho;
  let client: FacialDeviceClientService;
  let porta: number;

  // Agente sempre offline: força o caminho HTTP direto.
  const agenteOffline: any = { isOnline: () => false, enqueue: jest.fn() };

  const foto = Buffer.alloc(3000, 7).toString('base64');
  const hik = (): FacialDeviceConfig => ({
    id: 1,
    ip: '127.0.0.1',
    porta,
    api_user: USER,
    api_password: PASS,
    fabricante: 'hikvision',
  });
  const cid = (): FacialDeviceConfig => ({
    id: 2,
    ip: '127.0.0.1',
    porta,
    api_user: USER,
    api_password: PASS,
    fabricante: 'control_id',
  });

  beforeAll(async () => {
    estado = novoEstado();
    server = await subirAparelho(estado);
    porta = (server.address() as any).port;
    client = new FacialDeviceClientService(agenteOffline);
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  describe('Hikvision (ISAPI + Digest)', () => {
    it('responde ao ping e monta o Digest que o aparelho aceita', async () => {
      await expect(client.ping(hik())).resolves.toBe(true);
      expect(estado.digestValidado).toBeGreaterThan(0);
    });

    it('cadastra pessoa com rosto (multipart aceito pelo aparelho)', async () => {
      const r = await client.enrollPerson(hik(), {
        externalId: 'morador_42',
        nome: 'Ana Souza',
        fotoBase64: foto,
        validFrom: '2026-08-17 08:00:00',
        validTo: '2026-08-17 18:00:00',
      });
      expect(r.faceId).toBe('morador_42');
      expect(estado.usuariosHik.has('morador_42')).toBe(true);
      expect(estado.rostosHik.has('morador_42')).toBe(true);
      // A validade vai em ISO ("T" no lugar do espaço), como o ISAPI exige.
      expect(estado.usuariosHik.get('morador_42').Valid.beginTime).toBe(
        '2026-08-17T08:00:00',
      );
    });

    // Regravar a mesma pessoa é o caso comum do re-sync; o Record duplicado dá
    // erro e o cliente precisa cair para o Modify em vez de deixar pendente.
    it('re-cadastro cai para Modify sem estourar', async () => {
      await client.enrollPerson(hik(), {
        externalId: 'morador_42',
        nome: 'Ana Souza Silva',
        fotoBase64: foto,
      });
      expect(estado.usuariosHik.get('morador_42').name).toBe('Ana Souza Silva');
    });

    it('lista os employeeNo gravados (base da varredura de fantasmas)', async () => {
      await client.enrollPerson(hik(), {
        externalId: 'visitante_9',
        nome: 'Bob',
        fotoBase64: foto,
      });
      const ids = await client.listUserIds(hik());
      expect(ids.sort()).toEqual(['morador_42', 'visitante_9']);
    });

    // A varredura de fantasmas apaga o que está no aparelho e não está no
    // banco. O admin criado pelo instalador NO PRÓPRIO aparelho não pode
    // entrar nessa conta — apagá-lo o trancaria para fora do equipamento.
    it('não lista usuário criado no aparelho pelo instalador', async () => {
      estado.usuariosHik.set('admin_instalador', { employeeNo: 'admin_instalador' });
      const ids = await client.listUserIds(hik());
      expect(ids).not.toContain('admin_instalador');
      expect(ids.sort()).toEqual(['morador_42', 'visitante_9']);
      estado.usuariosHik.delete('admin_instalador');
    });

    it('remove em lote (sem lote no ISAPI, cai para individual)', async () => {
      await client.removeUsers(hik(), ['morador_42', 'visitante_9']);
      expect(estado.usuariosHik.size).toBe(0);
      expect(estado.rostosHik.size).toBe(0);
    });

    it('aciona o relé', async () => {
      const antes = estado.portaAberta;
      const r = await client.triggerRelay(hik());
      expect(r.ok).toBe(true);
      expect(estado.portaAberta).toBe(antes + 1);
    });

    // Nunca reportar sucesso quando a porta não abriu: tem gente esperando do
    // outro lado. Senha errada = 401 em todas as tentativas.
    it('reporta falha quando a credencial está errada', async () => {
      const r = await client.triggerRelay({ ...hik(), api_password: 'errada' });
      expect(r.ok).toBe(false);
    });
  });

  describe('Control iD (.fcgi com sessão)', () => {
    let idInterno: string;

    it('cadastra e devolve o id INTERNO do aparelho como faceId', async () => {
      const r = await client.enrollPerson(cid(), {
        externalId: 'morador_77',
        nome: 'Carla',
        fotoBase64: foto,
      });
      idInterno = r.faceId;
      // É por este id que o push nativo do aparelho resolve a pessoa — guardar
      // o nosso external_id aqui quebraria o reconhecimento.
      expect(idInterno).toMatch(/^\d+$/);
      expect(estado.usuariosCid.get(idInterno).registration).toBe('morador_77');
      expect(estado.rostosCid.has(idInterno)).toBe(true);
    });

    it('lista os ids internos', async () => {
      await expect(client.listUserIds(cid())).resolves.toContain(idInterno);
    });

    // No Control iD o id interno é indistinguível de um usuário do aparelho —
    // quem separa os nossos é o `registration`.
    it('não lista usuário sem registration nosso', async () => {
      estado.usuariosCid.set('1', { name: 'Admin', registration: 'admin' });
      const ids = await client.listUserIds(cid());
      expect(ids).not.toContain('1');
      expect(ids).toContain(idInterno);
      estado.usuariosCid.delete('1');
    });

    it('atualiza nome pelo id interno', async () => {
      await client.updatePerson(cid(), idInterno, { nome: 'Carla Dias' });
      expect(estado.usuariosCid.get(idInterno).name).toBe('Carla Dias');
    });

    it('aciona o relé', async () => {
      const antes = estado.portaAberta;
      const r = await client.triggerRelay(cid());
      expect(r.ok).toBe(true);
      expect(estado.portaAberta).toBe(antes + 1);
    });

    it('remove em lote', async () => {
      await client.removeUsers(cid(), [idInterno]);
      expect(estado.usuariosCid.has(idInterno)).toBe(false);
    });
  });
});
