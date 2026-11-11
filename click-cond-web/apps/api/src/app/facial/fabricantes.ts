/**
 * Registro único de fabricantes de terminal — UM lugar para responder "que
 * marca é esta?" e "esta marca sabe fazer X?".
 *
 * Antes havia listas independentes (capacidades em facial.service.ts, marcas
 * da descoberta em descoberta.service.ts, marcas sem HTTP em
 * facial-device-client.service.ts): incluir uma marca exigia lembrar de todas.
 *
 * As capacidades descrevem o que o código REALMENTE faz hoje (drivers do
 * Agente Local em agent/src/drivers e o modo direto em
 * facial-device-client.service.ts) — não o que o aparelho poderia fazer. Ao
 * implementar um comando novo para uma marca, ligue a capacidade aqui.
 */

/** Protocolo falado pela marca (a mesma divisão do registro de drivers do agente). */
export type FamiliaFabricante = 'dahua' | 'hikvision' | 'control_id' | 'generico' | 'sem_http';

export interface CapacidadesFabricante {
  /** Lista/remove em lote as pessoas gravadas no aparelho (varredura de fantasmas). */
  listagem: boolean;
  /** A câmera do terminal devolve um quadro JPEG para usar como foto de cadastro. */
  camera: boolean;
  /** O aparelho guarda a janela de validade (validFrom/validTo) e nega fora dela. */
  validadeNoAparelho: boolean;
  /** O aparelho conta os usos (userTimes) e nega depois do limite. */
  usoUnico: boolean;
  /** O Agente Local assina/consulta os acessos no aparelho e repassa para a nuvem. */
  eventosViaAgente: boolean;
  /** O Agente Local sabe achar aparelhos desta marca na LAN (etapa 3). */
  descoberta: boolean;
}

export type CapacidadeFabricante = keyof CapacidadesFabricante;

export interface InfoFabricante {
  /** Nome de vitrine. */
  rotulo: string;
  familia: FamiliaFabricante;
  /** Porta usada quando o cadastro não informa uma (createDevice: `dto.porta ?? 80`). */
  portaPadrao: number;
  /** Usuário que os drivers assumem quando o cadastro não informa; null = não há padrão. */
  usuarioPadrao: string | null;
  capacidades: CapacidadesFabricante;
  /**
   * Outras grafias aceitas na entrada, já em minúsculas e sem acento. A chave
   * canônica (sem acento) é aceita sempre, não precisa repetir aqui.
   */
  aliases: readonly string[];
  /**
   * Valores que o banco tem gravados em Facial_Devices.fabricante para esta
   * marca (a chave canônica e as grafias antigas). É o que entra num
   * `fabricante: { in: [...] }` do Prisma — ver valoresGravadosCom().
   */
  valoresGravados: readonly string[];
  /** Só família 'sem_http': o protocolo que a marca fala em vez de HTTP. */
  protocoloSemHttp?: string;
}

const NENHUMA: CapacidadesFabricante = {
  listagem: false,
  camera: false,
  validadeNoAparelho: false,
  usoUnico: false,
  eventosViaAgente: false,
  descoberta: false,
};

export const FABRICANTES_SUPORTADOS = {
  // Intelbras é OEM da Dahua: mesmo firmware, mesmo protocolo (RPC2 + cgi). O
  // banco tem as duas grafias; 'intelbras' é a canônica (é o que o agente
  // recebe no poll e o que a descoberta reporta).
  intelbras: {
    rotulo: 'Intelbras',
    familia: 'dahua',
    portaPadrao: 80,
    usuarioPadrao: 'admin',
    capacidades: {
      listagem: true,
      camera: true,
      validadeNoAparelho: true, // ValidFrom/ValidTo
      usoUnico: true, // UseTime (UserType=2)
      eventosViaAgente: true,
      descoberta: true, // DHIP
    },
    aliases: ['dahua'],
    valoresGravados: ['intelbras', 'dahua'],
  },
  hikvision: {
    rotulo: 'Hikvision',
    familia: 'hikvision',
    portaPadrao: 80,
    usuarioPadrao: 'admin',
    capacidades: {
      listagem: true,
      camera: true,
      validadeNoAparelho: true, // Valid.beginTime/endTime
      usoUnico: false, // o driver não envia userTimes
      eventosViaAgente: true,
      descoberta: true, // SADP
    },
    aliases: ['hik'],
    valoresGravados: ['hikvision'],
  },
  control_id: {
    rotulo: 'Control iD',
    familia: 'control_id',
    portaPadrao: 80,
    usuarioPadrao: 'admin',
    capacidades: {
      listagem: true,
      camera: false, // sem captura de quadro por este protocolo
      validadeNoAparelho: false, // o driver não envia validade
      usoUnico: false,
      eventosViaAgente: true, // polling em access_logs
      descoberta: true, // varredura da porta 80
    },
    aliases: ['controlid', 'control id', 'control-id'],
    valoresGravados: ['control_id'],
  },
  // HTTP simples (botoeira/relé, REST /persons). Chave acentuada porque é
  // assim que o portal grava e o banco guarda.
  genérico: {
    rotulo: 'Genérico',
    familia: 'generico',
    portaPadrao: 80,
    usuarioPadrao: null,
    capacidades: NENHUMA,
    aliases: [],
    valoresGravados: ['genérico'],
  },
  // Não falam HTTP para comandos (protocolo binário / SDK). Validado contra
  // documentação pública (jun/2026). Para acionar, use uma botoeira/relé HTTP
  // genérico ou um bridge SDK.
  zkteco: {
    rotulo: 'ZKTeco',
    familia: 'sem_http',
    portaPadrao: 80,
    usuarioPadrao: null,
    capacidades: NENHUMA,
    aliases: [],
    valoresGravados: ['zkteco'],
    protocoloSemHttp: 'protocolo TCP/UDP na porta 4370 (PULL/PUSH SDK)',
  },
  topdata: {
    rotulo: 'Topdata',
    familia: 'sem_http',
    portaPadrao: 80,
    usuarioPadrao: null,
    capacidades: NENHUMA,
    aliases: [],
    valoresGravados: ['topdata'],
    protocoloSemHttp: 'protocolo TCP na porta 3570 (SDK Inner)',
  },
  henry: {
    rotulo: 'Henry',
    familia: 'sem_http',
    portaPadrao: 80,
    usuarioPadrao: null,
    capacidades: NENHUMA,
    aliases: [],
    valoresGravados: ['henry'],
    protocoloSemHttp: 'protocolo proprietário (SDK Henry)',
  },
} as const satisfies Record<string, InfoFabricante>;

/** Chave canônica de um fabricante do registro. */
export type ChaveFabricante = keyof typeof FABRICANTES_SUPORTADOS;

/** Chave canônica do fabricante genérico (HTTP simples) — o fallback do modo direto. */
export const FABRICANTE_GENERICO = 'genérico' satisfies ChaveFabricante;

const CHAVES = Object.keys(FABRICANTES_SUPORTADOS) as ChaveFabricante[];
const info = (chave: ChaveFabricante): InfoFabricante => FABRICANTES_SUPORTADOS[chave];

/** trim + minúsculas + sem acento. */
function semAcento(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** grafia (minúscula, sem acento) → chave canônica. Map: 'constructor' etc. não casam. */
const INDICE = new Map<string, ChaveFabricante>();
for (const chave of CHAVES) {
  INDICE.set(semAcento(chave), chave);
  for (const alias of info(chave).aliases) INDICE.set(semAcento(alias), chave);
  for (const gravado of info(chave).valoresGravados) INDICE.set(semAcento(gravado), chave);
}

/**
 * Chave canônica do fabricante, ou null se não for uma marca do registro.
 * Aceita maiúsculas, espaços nas pontas, acento e os aliases de cada marca.
 * 'dahua' → 'intelbras' (mesma linha de aparelho).
 */
export function normalizarFabricante(bruto: unknown): ChaveFabricante | null {
  if (typeof bruto !== 'string') return null;
  return INDICE.get(semAcento(bruto)) ?? null;
}

/** A marca (em qualquer grafia aceita) tem a capacidade? Desconhecida = false. */
export function temCapacidade(fabricante: unknown, cap: CapacidadeFabricante): boolean {
  const chave = normalizarFabricante(fabricante);
  return chave !== null && info(chave).capacidades[cap];
}

/**
 * Valores GRAVADOS no banco das marcas com a capacidade — para filtros
 * `fabricante: { in: [...] }` (o banco tem 'dahua' além de 'intelbras').
 */
export function valoresGravadosCom(cap: CapacidadeFabricante): string[] {
  return CHAVES.filter((c) => info(c).capacidades[cap]).flatMap((c) => [...info(c).valoresGravados]);
}

/**
 * Protocolo da marca que NÃO aceita comando HTTP, ou undefined se ela fala
 * HTTP ou não é do registro. Casa pela chave exata (o chamador já recebe o
 * fabricante normalizado na borda).
 */
export function protocoloSemHttp(fabricante: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(FABRICANTES_SUPORTADOS, fabricante)
    ? info(fabricante as ChaveFabricante).protocoloSemHttp
    : undefined;
}

type ChaveComDescoberta = {
  [K in ChaveFabricante]: (typeof FABRICANTES_SUPORTADOS)[K]['capacidades']['descoberta'] extends true ? K : never;
}[ChaveFabricante];

/** Marcas que o agente sabe descobrir na LAN (o que a rota de descobertos aceita). */
export type FabricanteComDescoberta = ChaveComDescoberta;
export const FABRICANTES_COM_DESCOBERTA = CHAVES.filter((c) => info(c).capacidades.descoberta) as FabricanteComDescoberta[];

export interface FabricanteListado {
  chave: ChaveFabricante;
  rotulo: string;
  familia: FamiliaFabricante;
  portaPadrao: number;
  usuarioPadrao: string | null;
  capacidades: CapacidadesFabricante;
}

/** Uma linha por marca, na ordem do registro — para a tela montar o seletor. Devolve cópias. */
export function listarFabricantes(): FabricanteListado[] {
  return CHAVES.map((chave) => {
    const f = info(chave);
    return {
      chave,
      rotulo: f.rotulo,
      familia: f.familia,
      portaPadrao: f.portaPadrao,
      usuarioPadrao: f.usuarioPadrao,
      capacidades: { ...f.capacidades },
    };
  });
}
