import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret } from '../facial/device-secret.util';
import { pessoasMigrationEnabled } from '../common/pessoas-migration.util';
import {
  conferirMac,
  contadorDe,
  decodificarCodigo,
  normalizarLeitura,
  rotuloDeCredencial,
} from './codigo-dinamico.util';

export type MotivoNegacao =
  | 'desconhecida'
  | 'opcao_desligada'
  | 'revogada'
  | 'fora_validade'
  | 'assinatura'
  | 'expirado'
  | 'reuso'
  | 'visita_encerrada'
  | 'morador_removido';

export const TEXTO_NEGACAO: Record<MotivoNegacao, string> = {
  desconhecida: 'QR não reconhecido',
  opcao_desligada: 'QR no app desligado neste condomínio',
  revogada: 'QR cancelado',
  fora_validade: 'QR fora da validade',
  assinatura: 'QR inválido',
  expirado: 'QR vencido (mostre o código atual)',
  reuso: 'QR já usado neste leitor',
  visita_encerrada: 'Visita encerrada',
  morador_removido: 'Morador não encontrado',
};

export type ResultadoLeitura =
  | {
      ok: true;
      rotulo: string;
      idCredencial: number;
      contador: number;
      alvo:
        | { tipo: 'morador'; morador: { id: number; nome: string; tipo: string | null } }
        | { tipo: 'visita'; codigoAcesso: string };
    }
  | { ok: false; rotulo: string; motivo: MotivoNegacao };

/** A cada quantas gravações bem-sucedidas apaga as leituras antigas. */
const LIMPEZA_A_CADA = 200;
const RETENCAO_LEITURAS_MS = 10 * 60 * 1000;
const SEGREDO_HEX = /^[0-9a-f]{64}$/i;

/**
 * Valida a leitura de um código dinâmico (QR do app ou do passe do visitante).
 *
 * Só depende do Prisma, de propósito: o FacialModule usa este serviço e o
 * VisitantesModule importa o FacialModule; ficar fora desse ciclo evita
 * forwardRef. O código lido e o segredo nunca vão para o resultado nem para
 * log: o resultado carrega só o rótulo `cred:<id>`.
 */
@Injectable()
export class CredenciaisValidacaoService {
  private readonly logger = new Logger(CredenciaisValidacaoService.name);
  private gravacoesDesdeLimpeza = 0;

  constructor(private readonly prisma: PrismaService) {}

  async qrAppHabilitado(idCondominio: number): Promise<boolean> {
    const cond = await (this.prisma as any).condominios.findUnique({
      where: { id: idCondominio },
      select: { qr_app_habilitado: true },
    });
    return !!cond?.qr_app_habilitado;
  }

  async validarLeitura(
    valorLido: string,
    device: { id: number; id_condominio: number },
    instante: Date,
  ): Promise<ResultadoLeitura> {
    const p = this.prisma as any;

    // 1. Decodifica.
    const dec = decodificarCodigo(normalizarLeitura(valorLido));
    if (!dec) return { ok: false, rotulo: 'cred:?', motivo: 'desconhecida' };
    const rotulo = rotuloDeCredencial(valorLido);
    const negar = (motivo: MotivoNegacao): ResultadoLeitura => ({ ok: false, rotulo, motivo });

    // 2. Credencial existe e é do condomínio do leitor (mesmo motivo nos dois
    //    casos, para não revelar que o id existe em outro condomínio).
    const cred = await p.credenciais_Acesso.findUnique({ where: { id: dec.id } });
    if (!cred || cred.id_condominio !== device.id_condominio) return negar('desconhecida');

    // 3. Opção do condomínio.
    if (!(await this.qrAppHabilitado(device.id_condominio))) return negar('opcao_desligada');

    // 4. Revogação.
    if (cred.revogada_em) return negar('revogada');

    // 5. Validade própria da credencial (a da visita é conferida pelo fluxo do PIN).
    const t = instante.getTime();
    if (cred.valido_de && t < new Date(cred.valido_de).getTime()) return negar('fora_validade');
    if (cred.valido_ate && t > new Date(cred.valido_ate).getTime()) return negar('fora_validade');

    // 6. Assinatura.
    const segredoHex = decryptSecret(cred.segredo);
    if (!segredoHex || !SEGREDO_HEX.test(segredoHex)) return negar('assinatura');
    if (!conferirMac(dec, Buffer.from(segredoHex, 'hex'))) return negar('assinatura');

    // 7. Janela do contador: atual, anterior e seguinte.
    if (Math.abs(dec.contador - contadorDe(instante)) > 1) return negar('expirado');

    // 8. Alvo.
    let alvo:
      | { tipo: 'morador'; morador: { id: number; nome: string; tipo: string | null } }
      | { tipo: 'visita'; codigoAcesso: string };
    if (cred.tipo_pessoa === 'morador') {
      const morador =
        cred.id_pessoa != null
          ? await p.moradores.findUnique({
              where: { id: cred.id_pessoa },
              select: { id: true, nome: true, tipo: true, id_condominio: true },
            })
          : null;
      if (!morador || morador.id_condominio !== device.id_condominio) return negar('morador_removido');
      alvo = { tipo: 'morador', morador: { id: morador.id, nome: morador.nome, tipo: morador.tipo ?? null } };
    } else if (cred.tipo_pessoa === 'visita') {
      const usarVisitas = pessoasMigrationEnabled(p);
      const idAlvo = usarVisitas ? cred.id_visita : cred.id_visitante;
      const visita =
        idAlvo != null
          ? await (usarVisitas ? p.visitas : p.visitantes).findUnique({
              where: { id: idAlvo },
              select: { id: true, id_condominio: true, codigo_acesso: true },
            })
          : null;
      if (!visita || visita.id_condominio !== device.id_condominio || !visita.codigo_acesso) {
        return negar('visita_encerrada');
      }
      alvo = { tipo: 'visita', codigoAcesso: visita.codigo_acesso };
    } else {
      return negar('desconhecida');
    }

    // 9. Anti-reuso por leitor.
    try {
      await p.credenciais_Leituras.create({
        data: { id_credencial: cred.id, id_device: device.id, contador: dec.contador },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return negar('reuso');
      throw e;
    }

    // 10. Limpeza oportunista das leituras antigas.
    this.gravacoesDesdeLimpeza++;
    if (this.gravacoesDesdeLimpeza >= LIMPEZA_A_CADA) {
      this.gravacoesDesdeLimpeza = 0;
      try {
        Promise.resolve(
          p.credenciais_Leituras.deleteMany({
            where: { lido_em: { lt: new Date(Date.now() - RETENCAO_LEITURAS_MS) } },
          }),
        ).catch((err: any) => this.logger.warn(`Limpeza de Credenciais_Leituras falhou: ${err?.message ?? err}`));
      } catch (err: any) {
        this.logger.warn(`Limpeza de Credenciais_Leituras falhou: ${err?.message ?? err}`);
      }
    }

    return { ok: true, rotulo, idCredencial: cred.id, contador: dec.contador, alvo };
  }
}
