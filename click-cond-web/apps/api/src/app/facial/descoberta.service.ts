import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';

/**
 * Descoberta na rede (etapa 3 do agente). O agente acha aparelhos na LAN e
 * manda aqui (POST condo/:token/descobertos). Esta classe:
 *  - sanitiza (rota pública por token: corpo não confiável);
 *  - guarda a última lista por condomínio EM MEMÓRIA (como a telemetria:
 *    perder no restart é aceitável, volta em até 5 min);
 *  - aprende o MAC/série de devices cadastrados antes da etapa 3, e reaprende
 *    quando o aparelho físico foi trocado (MAC novo no endereço cadastrado);
 *  - corrige o IP de um device cujo MAC apareceu em outro endereço (DHCP),
 *    sempre dentro do MESMO condomínio, numa faixa plausível, com limite de
 *    frequência e com auditoria.
 */

const FABRICANTES = ['intelbras', 'hikvision', 'control_id'] as const;
const MAX_ACHADOS = 200;
// Octetos canônicos: 0 ou 1–255 sem zero à esquerda ("010" é lido como octal
// por alguns clientes HTTP e apontaria para outro host). O agente sempre manda
// neste formato; qualquer outra grafia é corpo forjado ou lixo.
const IPV4 = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const MAX_CORRECOES_POR_HORA = 3;
const UMA_HORA_MS = 3600 * 1000;

export interface Achado {
  mac: string | null;
  ip: string;
  porta: number;
  fabricante: (typeof FABRICANTES)[number];
  modelo: string | null;
  numero_serie: string | null;
  dhcp: boolean | null;
  validado_em_campo: boolean;
  /** DeviceClass do DHIP (ex. 'BSC' = controle de acesso); null quando o protocolo não informa. */
  classe: string | null;
}
export interface AchadoNuvem extends Achado {
  id_dispositivo: number | null;
}
export interface AvisoIp {
  id_dispositivo: number;
  nome: string;
  /** 'porta' quando só a porta HTTP mudou — aí `de`/`para` são as portas. */
  tipo: 'ip' | 'porta';
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

/**
 * IPv4 de host numa LAN privada (RFC 1918: 10/8, 172.16/12, 192.168/16), em
 * forma canônica. A rota do agente é pública por token: sem isto, um corpo
 * forjado poderia "corrigir" o IP de um terminal para um endereço público,
 * loopback ou multicast e desviar para lá os comandos (que levam a senha do
 * aparelho). Final .0/.255 fica de fora: rede/broadcast da /24 típica de
 * portaria — nenhum terminal mora ali.
 */
export function ipPrivadoCanonico(s: unknown): s is string {
  const m = typeof s === 'string' ? s.match(IPV4) : null;
  if (!m) return false;
  const [a, b, , d] = m.slice(1).map(Number);
  if (m.slice(1).some((o) => Number(o) > 255)) return false;
  if (d === 0 || d === 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function prefixo24(ip: unknown): string | null {
  return typeof ip === 'string' ? ip.split('.').slice(0, 3).join('.') : null;
}

function texto(s: unknown, max: number): string | null {
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null;
}

/** Classe curta (DeviceClass costuma ter 3–4 letras); maior que 20 é lixo, não trunca. */
function classeValida(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t && t.length <= 20 ? t : null;
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
    if (!ipPrivadoCanonico(o['ip']) || !FABRICANTES.includes(o['fabricante'] as any)) continue;
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
      classe: classeValida(o['classe']),
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
  /** Por device, quando houve correção de endereço (ms) — limite de frequência em memória. */
  private readonly correcoes = new Map<number, number[]>();

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
    const macDeOutro = (d: any, mac: string) => devices.some((o) => o.id !== d.id && o.mac === mac);

    // 1) Aprende MAC de quem ainda não tem: pelo relato do agente (IP do
    //    cadastro respondeu e a ARP deu o MAC) ou por um achado no mesmo IP.
    for (const d of devices) {
      if (d.mac) continue;
      const doAgente = macs_cadastrados.find((m) => m.id === d.id)?.mac ?? null;
      const noIp = achados.find((a) => a.ip === d.ip && a.mac);
      const mac = doAgente ?? noIp?.mac ?? null;
      if (!mac || macDeOutro(d, mac)) continue;
      const data: any = { mac };
      if (!d.numero_serie && noIp?.numero_serie) data.numero_serie = noIp.numero_serie;
      await this.prisma.facial_Devices.update({ where: { id: d.id }, data });
      Object.assign(d, data);
      macs_aprendidos++;
    }

    // 2) Reaprende o MAC de quem teve o aparelho físico TROCADO (defeito,
    //    upgrade) mantendo o cadastro: o endereço cadastrado agora responde
    //    com outro MAC. Roda ANTES da correção de IP de propósito — se o
    //    aparelho velho for religado em outro ponto da rede, sem isto ele
    //    "puxaria" o cadastro (IP corrigido para ele) e o novo ficaria órfão.
    for (const d of devices) {
      if (!d.mac) continue;
      const doAgente = macs_cadastrados.find((m) => m.id === d.id && m.mac !== d.mac)?.mac ?? null;
      const noEndereco = achados.find((a) => a.ip === d.ip && a.porta === d.porta && a.mac && a.mac !== d.mac) ?? null;
      // Pelo achado (sem o relato do agente), só vale se o MAC antigo não
      // apareceu em outro IP nesta mesma leitura: aí é o aparelho que MUDOU
      // de endereço (e outro herdou o IP velho) — caso da correção de IP.
      const velhoVistoEmOutroIp = achados.some((a) => a.mac === d.mac && a.ip !== d.ip);
      const mac = doAgente ?? (velhoVistoEmOutroIp ? null : noEndereco?.mac ?? null);
      if (!mac || macDeOutro(d, mac)) continue;
      const doNovo = achados.find((a) => a.mac === mac && a.ip === d.ip) ?? null;
      const de = d.mac;
      // A série antiga é do aparelho que saiu: fica a do novo, ou nada.
      const data = { mac, numero_serie: doNovo?.numero_serie ?? null };
      await this.prisma.facial_Devices.update({ where: { id: d.id }, data });
      Object.assign(d, data);
      macs_aprendidos++;
      this.logger.log(`MAC do dispositivo ${d.id} atualizado de ${de} para ${mac} (aparelho trocado no mesmo endereço)`);
      await this.auditoria.registrar({
        id_condominio: idCondominio,
        usuario_nome: 'Sistema (descoberta na rede)',
        acao: 'DISPOSITIVO_MAC_ATUALIZADO',
        modulo: 'facial-health',
        entidade_id: d.id,
        descricao: `MAC do dispositivo "${d.nome}" atualizado de ${de} para ${mac} (outro aparelho respondeu em ${d.ip}:${d.porta}).`,
        detalhes: { de, para: mac, ip: d.ip, porta: d.porta },
      });
    }

    // 3) Corrige o endereço: mesmo MAC, IP/porta diferente, IP novo livre no
    //    condomínio e plausível (privado, numa /24 que o condomínio já usa).
    for (const a of achados) {
      if (!a.mac) continue;
      const d = devices.find((x) => x.mac === a.mac);
      if (!d || (d.ip === a.ip && d.porta === a.porta)) continue;
      if (devices.some((o) => o.id !== d.id && o.ip === a.ip)) continue;
      if (!this.destinoPlausivel(d, a.ip, devices)) {
        this.logger.warn(`Correção de IP ignorada: dispositivo ${d.id} (${d.ip}) → ${a.ip} fora das redes do condomínio ${idCondominio}`);
        continue;
      }
      if (!this.dentroDoLimite(d.id)) {
        this.logger.warn(
          `Correção de IP ignorada: dispositivo ${d.id} já teve ${MAX_CORRECOES_POR_HORA} correções na última hora (${d.ip}:${d.porta} → ${a.ip}:${a.porta})`,
        );
        continue;
      }
      const ipMudou = d.ip !== a.ip;
      const de = ipMudou ? d.ip : String(d.porta);
      const para = ipMudou ? a.ip : String(a.porta);
      await this.prisma.facial_Devices.update({ where: { id: d.id }, data: { ip: a.ip, porta: a.porta } });
      const portaAntes = d.porta;
      const ipAntes = d.ip;
      d.ip = a.ip;
      d.porta = a.porta;
      ips_corrigidos++;
      const aviso: AvisoIp = { id_dispositivo: d.id, nome: d.nome, tipo: ipMudou ? 'ip' : 'porta', de, para, em: new Date().toISOString() };
      this.avisos.set(idCondominio, [aviso, ...(this.avisos.get(idCondominio) ?? [])].slice(0, 10));
      const descricao = ipMudou
        ? `IP do dispositivo "${d.nome}" atualizado de ${de} para ${para} (mesmo MAC ${a.mac}).`
        : `Porta do dispositivo "${d.nome}" atualizada de ${de} para ${para} (mesmo MAC ${a.mac}).`;
      this.logger.log(`Dispositivo ${d.id}: ${ipAntes}:${portaAntes} → ${a.ip}:${a.porta} (MAC ${a.mac})`);
      await this.auditoria.registrar({
        id_condominio: idCondominio,
        usuario_nome: 'Sistema (descoberta na rede)',
        acao: 'DISPOSITIVO_IP_CORRIGIDO',
        modulo: 'facial-health',
        entidade_id: d.id,
        descricao,
        detalhes: { de: ipAntes, para: a.ip, porta_de: portaAntes, porta_para: a.porta, mac: a.mac },
      });
    }

    this.ultimos.set(idCondominio, { recebido_em: new Date().toISOString(), achados });
    return { ok: true as const, ips_corrigidos, macs_aprendidos };
  }

  /** Mesma /24 do IP antigo ou de outro device ativo do condomínio: é lá que a portaria mora. */
  private destinoPlausivel(d: any, ip: string, devices: any[]): boolean {
    if (!ipPrivadoCanonico(ip)) return false;
    const alvo = prefixo24(ip);
    return prefixo24(d.ip) === alvo || devices.some((o) => o.id !== d.id && prefixo24(o.ip) === alvo);
  }

  /**
   * No máximo MAX_CORRECOES_POR_HORA por device (em memória, por instância).
   * Um IP que "pula" toda hora é sinal de rede estranha (dois aparelhos
   * brigando pelo mesmo MAC, relato forjado) — não vale seguir cegamente.
   * Registra a correção quando permite.
   */
  private dentroDoLimite(idDevice: number): boolean {
    const agora = Date.now();
    const recentes = (this.correcoes.get(idDevice) ?? []).filter((t) => agora - t < UMA_HORA_MS);
    if (recentes.length >= MAX_CORRECOES_POR_HORA) {
      this.correcoes.set(idDevice, recentes);
      return false;
    }
    this.correcoes.set(idDevice, [...recentes, agora]);
    return true;
  }

  async listar(idCondominio: number): Promise<{ recebido_em: string | null; achados: AchadoNuvem[]; avisos: AvisoIp[] }> {
    const u = this.ultimos.get(idCondominio);
    // Leitura fresca: um device cadastrado (ou apagado) depois da última
    // recepção já aparece certo no portal, sem esperar a próxima descoberta.
    const devs = u?.achados.length
      ? await this.prisma.facial_Devices.findMany({
          where: { id_condominio: idCondominio, ativo: 1 },
          select: { id: true, ip: true, mac: true },
        })
      : [];
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
