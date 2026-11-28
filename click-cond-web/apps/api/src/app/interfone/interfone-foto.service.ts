import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { executarComLock } from '../common/lock-distribuido';
import { AgentBridgeService } from '../facial/agent-bridge.service';
import { temCapacidade } from '../facial/fabricantes';
import type { CapturadorFotoInterfone } from './interfone.service';

/** Foto do visitante: apagada depois disto (Global Constraints). */
export const FOTO_INTERFONE_RETENCAO_DIAS = 90;
/** Só apaga objetos que o interfone gravou. */
export const PREFIXOS_FOTO_INTERFONE: readonly string[] = ['interfone/'];
const DIA_MS = 24 * 3_600_000;
const FOTOS_VERIFICA_MS = 3_600_000;
const LOTE_FOTOS = 500;

/**
 * Foto do visitante tirada pelo próprio facial no começo da chamada (mesmo
 * caminho da foto de cadastro: comando `snapshot` no Agente Local). Só para
 * fabricante com câmera no registro de fabricantes. Nunca lança e nunca
 * atrasa o toque: o núcleo dispara sem esperar.
 */
@Injectable()
export class InterfoneFotoService implements CapturadorFotoInterfone, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InterfoneFotoService.name);
  private fotosInterval?: ReturnType<typeof setInterval>;
  /** Público para os testes; em produção é Date.now. */
  agora: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly agent?: AgentBridgeService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    // Uma vez por dia no cluster (o lock guarda a última passada).
    this.fotosInterval = setInterval(
      () =>
        void executarComLock(this.prisma, 'interfone:fotos', async () => void (await this.tickFotos()), {
          intervaloMinimoMs: DIA_MS,
        }),
      FOTOS_VERIFICA_MS,
    );
    this.fotosInterval.unref?.();
  }

  onModuleDestroy() {
    if (this.fotosInterval) clearInterval(this.fotosInterval);
  }

  async capturar(idChamada: number, device: { id: number; fabricante?: unknown }): Promise<void> {
    try {
      if (!this.agent || !this.storage) return;
      if (!temCapacidade(device?.fabricante, 'camera')) return;
      const r = await this.agent.enqueue(device.id, { type: 'snapshot' });
      if (!r.ok || !r.imageBase64) {
        this.logger.debug?.(`Interfone: sem foto na chamada ${idChamada}: ${r.error ?? 'sem imagem'}`);
        return;
      }
      const url = await this.storage.uploadDataUrl(`data:image/jpeg;base64,${r.imageBase64}`, 'interfone');
      // Sem bucket o storage devolve o próprio data URL: não cabe na coluna nem deve ir para o banco.
      if (!url || url.startsWith('data:') || url.length > 500) return;
      await this.prisma.interfone_Chamadas.updateMany({ where: { id: idChamada }, data: { foto: url } });
    } catch (e: any) {
      this.logger.warn(`Interfone: foto da chamada ${idChamada} falhou: ${e?.message ?? e}`);
    }
  }

  /**
   * Fotos de chamadas com mais de `dias`: apaga do bucket (só dentro de
   * interfone/) e zera a coluna. Lotes por id; arquivo que falha fica para a
   * próxima passada.
   */
  async tickFotos(dias = FOTO_INTERFONE_RETENCAO_DIAS): Promise<number> {
    if (!this.storage) return 0;
    const limite = new Date(this.agora() - dias * DIA_MS);
    let cursor = 0;
    let apagadas = 0;
    for (;;) {
      const lote = await this.prisma.interfone_Chamadas.findMany({
        where: { id: { gt: cursor }, created_at: { lt: limite }, foto: { not: null } },
        select: { id: true, foto: true },
        orderBy: { id: 'asc' },
        take: LOTE_FOTOS,
      });
      if (!lote.length) break;
      for (const c of lote) {
        cursor = c.id;
        try {
          if (!(await this.storage.deleteUrl(c.foto, PREFIXOS_FOTO_INTERFONE))) continue;
          await this.prisma.interfone_Chamadas.update({ where: { id: c.id }, data: { foto: null } });
          apagadas++;
        } catch (e: any) {
          this.logger.warn(`Interfone: foto da chamada ${c.id} não apagada: ${e?.message ?? e}`);
        }
      }
      if (lote.length < LOTE_FOTOS) break;
    }
    return apagadas;
  }
}
