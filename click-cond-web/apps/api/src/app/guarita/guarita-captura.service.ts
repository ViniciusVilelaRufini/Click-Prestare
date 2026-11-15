import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import {
  ESTADO_OP,
  ESTADO_TAG,
  JANELA_CAPTURA_MS,
  MSG_CODIGO_IMPRESSO_INVALIDO,
  MSG_RF_SO_POR_CAPTURA,
  NAO_CADASTRADO_TTL_MS,
  OPERACAO_CAPTURA,
  TIPO_TAG_POR_GUARITA,
  prefixoNaoCadastrado,
} from './guarita.constantes';
import { GuaritaAgenteService, NaoCadastradoGuardado } from './guarita-agente.service';
import { GuaritaOperacoesService } from './guarita-operacoes.service';
import { buscarGuaritaDoCondominio } from './guarita-comum.util';
import { wiegandParaSerial } from './guarita-frame.util';

/** Folga para a última consulta da tela, que chega logo depois dos 60 s. */
const FOLGA_LISTAGEM_MS = 5_000;
/** Depois de aberta, a janela aceita a confirmação enquanto o capturado ainda está guardado. */
const CONFIRMACAO_MS = NAO_CADASTRADO_TTL_MS;

/** Item de `GET …/captura`. */
export interface CapturadoNoConsole {
  tipo: number;
  serial_hex: string;
  tem_contador: boolean;
  recebido_em: string;
  comando: number;
  receptor: number | null;
  bateria_fraca: boolean;
}

/**
 * Cadastro por aproximação e cadastro pelo código impresso.
 *
 * A janela de 60 s é uma linha `Guarita_Operacoes` tipo `captura` (nunca
 * entregue ao agente): as duas instâncias enxergam a mesma. Os "não
 * cadastrados" que o agente repassa (42/46/90) ficam 10 min no
 * Estado_Compartilhado; a captura lista só os que chegaram (hora da nuvem)
 * depois que a janela abriu, e só deste Guarita.
 *
 * NÃO validado em aparelho.
 */
@Injectable()
export class GuaritaCapturaService {
  private readonly estado: EstadoCompartilhado;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agente: GuaritaAgenteService,
    private readonly operacoes: GuaritaOperacoesService,
  ) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  /** `POST …/captura { id_veiculo }`: abre a janela (uma por Guarita: a anterior é cancelada). */
  async abrir(idCondominio: number, deviceId: number, idVeiculoBruto: unknown, autor: string) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    if (device.ativo !== 1) throw new BadRequestException('Este Guarita está desativado.');
    const veiculo = await this.veiculoLivre(device.id_condominio, idVeiculoBruto);
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id_device: device.id, tipo: OPERACAO_CAPTURA, estado: ESTADO_OP.pendente },
      data: { estado: ESTADO_OP.cancelada, concluida_em: new Date() },
    });
    const janela = await this.prisma.guarita_Operacoes.create({
      data: {
        id_condominio: device.id_condominio,
        id_device: device.id,
        id_veiculo: veiculo.id,
        tipo: OPERACAO_CAPTURA,
        estado: ESTADO_OP.pendente,
        criado_por: autor,
      },
    });
    return {
      id_janela: janela.id,
      id_veiculo: veiculo.id,
      aberta_em: janela.created_at,
      expira_em: new Date(new Date(janela.created_at).getTime() + JANELA_CAPTURA_MS),
    };
  }

  /** `GET …/captura`: o que chegou deste Guarita desde que a janela abriu (vazio sem janela). */
  async listar(idCondominio: number, deviceId: number): Promise<CapturadoNoConsole[]> {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const janela = await this.janelaAberta(device.id, JANELA_CAPTURA_MS + FOLGA_LISTAGEM_MS);
    if (!janela) return [];
    const capturados = await this.capturadosDesde(device.id, new Date(janela.created_at));
    return capturados.map((c) => ({
      tipo: c.tipo,
      serial_hex: c.serial_hex,
      tem_contador: c.contador != null,
      recebido_em: c.chegou_em,
      comando: c.comando,
      receptor: c.receptor,
      bateria_fraca: c.bateria_fraca,
    }));
  }

  /** `POST …/captura/confirmar { tipo, serial_hex, id_veiculo? }`: cria a tag e enfileira o cadastro. */
  async confirmar(idCondominio: number, deviceId: number, corpo: any, autor: string) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const janela = await this.janelaAberta(device.id, CONFIRMACAO_MS);
    if (!janela) throw new BadRequestException('Abra a captura de novo: a janela de cadastro terminou.');
    if (corpo?.id_veiculo !== undefined && corpo?.id_veiculo !== null && Number(corpo.id_veiculo) !== janela.id_veiculo) {
      throw new BadRequestException('O veículo não é o desta captura. Abra a captura de novo.');
    }
    const tipo = Number(corpo?.tipo);
    const serial = typeof corpo?.serial_hex === 'string' ? corpo.serial_hex.trim().toUpperCase() : '';
    const capturado = (await this.capturadosDesde(device.id, new Date(janela.created_at))).find(
      (c) => c.tipo === tipo && c.serial_hex === serial,
    );
    if (!capturado) throw new BadRequestException('Este dispositivo não foi capturado nesta janela.');
    // RF: o contador só vem completo no 42 e no 90 (o 46 traz só o byte baixo).
    if (tipo === 1 && capturado.contador == null) throw new BadRequestException(MSG_RF_SO_POR_CAPTURA);
    const r = await this.criarDispositivo(device, janela.id_veiculo as number, tipo, serial, capturado.contador, autor);
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id: janela.id, estado: ESTADO_OP.pendente },
      data: { estado: ESTADO_OP.ok, id_tag: r.id_tag, concluida_em: new Date() },
    });
    await this.estado.remover(`${prefixoNaoCadastrado(device.id)}${tipo}:${serial}`);
    return r;
  }

  /** `POST …/dispositivos { id_veiculo, tipo: 2|3|6, codigo_impresso }`: TAG/cartão pelo código impresso. */
  async cadastrarDigitado(idCondominio: number, deviceId: number, corpo: any, autor: string) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const tipo = Number(corpo?.tipo);
    if (tipo === 1) throw new BadRequestException(MSG_RF_SO_POR_CAPTURA);
    if (![2, 3, 6].includes(tipo)) throw new BadRequestException('Tipo inválido: use 2 (TAG ativo), 3 (cartão) ou 6 (TAG passivo).');
    const serial = wiegandParaSerial(String(corpo?.codigo_impresso ?? ''));
    if (!serial) throw new BadRequestException(MSG_CODIGO_IMPRESSO_INVALIDO);
    const veiculo = await this.veiculoLivre(device.id_condominio, corpo?.id_veiculo);
    return this.criarDispositivo(device, veiculo.id, tipo, serial, null, autor);
  }

  // ----------------------------------------------------------------------

  private async janelaAberta(idDevice: number, validadeMs: number) {
    return this.prisma.guarita_Operacoes.findFirst({
      where: {
        id_device: idDevice,
        tipo: OPERACAO_CAPTURA,
        estado: ESTADO_OP.pendente,
        created_at: { gte: new Date(Date.now() - validadeMs) },
      },
      orderBy: { id: 'desc' },
    });
  }

  private async capturadosDesde(idDevice: number, desde: Date): Promise<NaoCadastradoGuardado[]> {
    const todos = await this.agente.listarNaoCadastrados(idDevice);
    return todos
      .filter((c) => new Date(c.chegou_em).getTime() >= desde.getTime())
      .sort((a, b) => a.chegou_em.localeCompare(b.chegou_em));
  }

  private async veiculoLivre(idCondominio: number, idVeiculoBruto: unknown) {
    const idVeiculo = Number(idVeiculoBruto);
    if (!Number.isInteger(idVeiculo) || idVeiculo <= 0) throw new BadRequestException('Informe o veículo.');
    const veiculo = await this.prisma.veiculos.findFirst({
      where: { id: idVeiculo, id_condominio: idCondominio, ativo: 1 },
      select: { id: true, id_tag: true },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado.');
    // Uma tag por veículo ativo (regra de Veículos): o controle/tag do Guarita ocupa o lugar.
    if (veiculo.id_tag != null) throw new BadRequestException('Este veículo já tem uma tag. Desvincule a atual antes.');
    return veiculo;
  }

  /** Tag nova do Guarita ligada ao veículo + cadastro na fila; se o cadastro não monta, nada fica. */
  private async criarDispositivo(
    device: { id: number; id_condominio: number },
    idVeiculo: number,
    tipo: number,
    serial: string,
    contador: number | null,
    autor: string,
  ) {
    const repetida = await this.prisma.tags.findFirst({
      where: { id_device: device.id, guarita_tipo: tipo, guarita_serial: serial },
      select: { id: true },
    });
    if (repetida) throw new BadRequestException('Este dispositivo já está cadastrado neste Guarita.');
    const veiculo = await this.veiculoLivre(device.id_condominio, idVeiculo);
    const base = `G${tipo}-${serial}`;
    let tag: any = null;
    for (const codigo of [base, `${base}-D${device.id}`]) {
      try {
        tag = await this.prisma.tags.create({
          data: {
            id_condominio: device.id_condominio,
            codigo,
            tipo: TIPO_TAG_POR_GUARITA[tipo],
            ativo: 1,
            id_device: device.id,
            guarita_tipo: tipo,
            guarita_serial: serial,
            guarita_contador: tipo === 1 ? contador : null,
            guarita_estado: ESTADO_TAG.pendente,
          },
        });
        break;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
      }
    }
    if (!tag) throw new BadRequestException('Já existe uma tag com este código no condomínio.');
    await this.prisma.veiculos.update({ where: { id: veiculo.id }, data: { id_tag: tag.id } });
    try {
      const { id_operacao } = await this.operacoes.enfileirarCadastro(tag.id, autor);
      return { id_tag: tag.id, estado: ESTADO_TAG.pendente, id_operacao };
    } catch (err) {
      await this.prisma.veiculos.update({ where: { id: veiculo.id }, data: { id_tag: null } });
      await this.prisma.tags.delete({ where: { id: tag.id } });
      throw err;
    }
  }
}
