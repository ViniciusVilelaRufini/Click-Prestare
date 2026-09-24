import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';

/**
 * Descoberta na rede (etapa 3 do agente). O agente acha aparelhos na LAN e
 * manda aqui (POST condo/:token/descobertos). Esta classe:
 *  - sanitiza (rota pública por token: corpo não confiável);
 *  - guarda a última lista por condomínio EM MEMÓRIA (como a telemetria:
 *    perder no restart é aceitável, volta em até 5 min);
 *  - aprende o MAC/série de devices cadastrados antes da etapa 3;
 *  - corrige o IP de um device cujo MAC apareceu em outro endereço (DHCP),
 *    sempre dentro do MESMO condomínio e com auditoria.
 */

const FABRICANTES = ['intelbras', 'hikvision', 'control_id'] as const;
const MAX_ACHADOS = 200;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export interface Achado {
  mac: string | null;
  ip: string;
  porta: number;
  fabricante: (typeof FABRICANTES)[number];
  modelo: string | null;
  numero_serie: string | null;
  dhcp: boolean | null;
  validado_em_campo: boolean;
}
export interface AchadoNuvem extends Achado {
  id_dispositivo: number | null;
}
export interface AvisoIp {
  id_dispositivo: number;
  nome: string;
  de: string;
  para: string;
  em: string;
}

/**
 * Normaliza um MAC para o formato canônico `aa:bb:cc:dd:ee:ff` (minúsculo).
 * Exportado para ser reutilizado por `facial.service.ts` (createDevice) —
 * uma única regra de normalização de MAC no módulo (ver Ruling 2).
 */
export function normalizarMac(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const hex = s.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12 || hex === '000000000000' || hex === 'ffffffffffff') return null;
  return hex.match(/../g)!.join(':');
}
function ipValido(s: unknown): s is string {
  const m = typeof s === 'string' ? s.match(IPV4) : null;
  return !!m && m.slice(1).every((p) => Number(p) <= 255);
}
function texto(s: unknown, max: number): string | null {
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null;
}

export function sanitizarDescobertos(raw: unknown): {
  achados: Achado[];
  macs_cadastrados: { id: number; mac: string }[];
} {
  const corpo = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const achados: Achado[] = [];
  for (const a of Array.isArray(corpo['achados']) ? corpo['achados'] : []) {
    if (achados.length >= MAX_ACHADOS) break;
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    if (!ipValido(o['ip']) || !FABRICANTES.includes(o['fabricante'] as any)) continue;
    const porta = Number(o['porta']);
    achados.push({
      mac: normalizarMac(o['mac']),
      ip: o['ip'] as string,
      porta: Number.isInteger(porta) && porta > 0 && porta < 65536 ? porta : 80,
      fabricante: o['fabricante'] as Achado['fabricante'],
      modelo: texto(o['modelo'], 100),
      numero_serie: texto(o['numero_serie'], 64),
      dhcp: typeof o['dhcp'] === 'boolean' ? (o['dhcp'] as boolean) : null,
      validado_em_campo: o['validado_em_campo'] === true,
    });
  }
  const macs_cadastrados: { id: number; mac: string }[] = [];
  for (const m of Array.isArray(corpo['macs_cadastrados']) ? corpo['macs_cadastrados'].slice(0, MAX_ACHADOS) : []) {
    const id = Number((m as any)?.id);
    const mac = normalizarMac((m as any)?.mac);
    if (Number.isInteger(id) && id > 0 && mac) macs_cadastrados.push({ id, mac });
  }
  return { achados, macs_cadastrados };
}

@Injectable()
export class DescobertaService {
  private readonly logger = new Logger(DescobertaService.name);
  private readonly ultimos = new Map<number, { recebido_em: string; achados: Achado[] }>();
  private readonly avisos = new Map<number, AvisoIp[]>();
  private readonly pedidos = new Set<number>();
  /** Por condomínio, os devices (id, ip, mac) vistos na última recepção: `listar` marca `id_dispositivo` sem ir ao banco. */
  private readonly cadastrados = new Map<number, { id: number; ip: string; mac: string | null }[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async receber(idCondominio: number, corpo: unknown) {
    const { achados, macs_cadastrados } = sanitizarDescobertos(corpo);
    const devices: any[] = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1 },
    });
    let macs_aprendidos = 0;
    let ips_corrigidos = 0;

    // 1) Aprende MAC de quem ainda não tem: pelo relato do agente (IP do
    //    cadastro respondeu e a ARP deu o MAC) ou por um achado no mesmo IP.
    for (const d of devices) {
      if (d.mac) continue;
      const doAgente = macs_cadastrados.find((m) => m.id === d.id)?.mac ?? null;
      const noIp = achados.find((a) => a.ip === d.ip && a.mac);
      const mac = doAgente ?? noIp?.mac ?? null;
      if (!mac || devices.some((o) => o.id !== d.id && o.mac === mac)) continue;
      const data: any = { mac };
      if (!d.numero_serie && noIp?.numero_serie) data.numero_serie = noIp.numero_serie;
      await this.prisma.facial_Devices.update({ where: { id: d.id }, data });
      Object.assign(d, data);
      macs_aprendidos++;
    }

    // 2) Corrige IP: mesmo MAC, endereço diferente, IP novo livre no condomínio.
    for (const a of achados) {
      if (!a.mac) continue;
      const d = devices.find((x) => x.mac === a.mac);
      if (!d || (d.ip === a.ip && d.porta === a.porta)) continue;
      if (devices.some((o) => o.id !== d.id && o.ip === a.ip)) continue;
      const de = d.ip;
      await this.prisma.facial_Devices.update({ where: { id: d.id }, data: { ip: a.ip, porta: a.porta } });
      d.ip = a.ip;
      d.porta = a.porta;
      ips_corrigidos++;
      const aviso: AvisoIp = { id_dispositivo: d.id, nome: d.nome, de, para: a.ip, em: new Date().toISOString() };
      this.avisos.set(idCondominio, [aviso, ...(this.avisos.get(idCondominio) ?? [])].slice(0, 10));
      this.logger.log(`IP do dispositivo ${d.id} corrigido de ${de} para ${a.ip} (MAC ${a.mac})`);
      await this.auditoria.registrar({
        id_condominio: idCondominio,
        usuario_nome: 'Sistema (descoberta na rede)',
        acao: 'DISPOSITIVO_IP_CORRIGIDO',
        modulo: 'facial-health',
        entidade_id: d.id,
        descricao: `IP do dispositivo "${d.nome}" atualizado de ${de} para ${a.ip} (mesmo MAC ${a.mac}).`,
        detalhes: { de, para: a.ip, mac: a.mac },
      });
    }

    this.ultimos.set(idCondominio, { recebido_em: new Date().toISOString(), achados });
    this.cadastrados.set(idCondominio, devices.map((d) => ({ id: d.id, ip: d.ip, mac: d.mac ?? null })));
    return { ok: true as const, ips_corrigidos, macs_aprendidos };
  }

  listar(idCondominio: number): { recebido_em: string | null; achados: AchadoNuvem[]; avisos: AvisoIp[] } {
    const u = this.ultimos.get(idCondominio);
    const devs = this.cadastrados.get(idCondominio) ?? [];
    const limite = Date.now() - 24 * 3600 * 1000;
    return {
      recebido_em: u?.recebido_em ?? null,
      achados: (u?.achados ?? []).map((a) => ({
        ...a,
        id_dispositivo: devs.find((d) => (a.mac && d.mac === a.mac) || d.ip === a.ip)?.id ?? null,
      })),
      avisos: (this.avisos.get(idCondominio) ?? []).filter((v) => Date.parse(v.em) >= limite),
    };
  }

  pedirProcura(idCondominio: number): void {
    this.pedidos.add(idCondominio);
  }

  consumirPedido(idCondominio: number): boolean {
    return this.pedidos.delete(idCondominio);
  }
}
