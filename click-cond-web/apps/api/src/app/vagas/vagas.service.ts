import {
  BadRequestException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FacialService } from '../facial/facial.service';
import { pessoasMigrationEnabled } from '../common/pessoas-migration.util';

/**
 * Versão canônica (portaria-web) do módulo de Vagas — mesma regra de negócio
 * de `MobileAuthService` (VAGAS), mas parametrizada por `id_apartamento` em
 * vez de resolver o morador a partir do JWT: aqui é o operador da portaria
 * gerenciando a vaga de QUALQUER apartamento, não o morador a própria.
 */
@Injectable()
export class VagasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facial: FacialService,
  ) {}

  private async resolveApartamento(idCondominio: number, idApartamento: number) {
    const apto = await this.prisma.apartamentos.findFirst({
      where: { id: Number(idApartamento), id_condominio: Number(idCondominio) },
    });
    if (!apto) throw new NotFoundException('Apartamento não encontrado neste condomínio.');
    return apto;
  }

  /** Moradores vinculados ao apto pelo par (bloco, apto) — mesmo critério usado no app. */
  private async moradoresDoApto(apto: { id_condominio: number; bloco: string | null; apto: string | null }) {
    return this.prisma.moradores.findMany({
      where: { id_condominio: apto.id_condominio, bloco: apto.bloco, apartamento: apto.apto },
      select: { id: true, nome: true, tipo: true },
    });
  }

  private mapVaga(v: any) {
    return {
      id: v.id,
      tipo_ocupacao: v.tipo_ocupacao,
      id_morador_titular: v.id_morador_titular,
      id_veiculo: v.id_veiculo,
      id_visitante: v.id_visitante,
      id_visita: v.id_visita ?? null,
      id_morador_beneficiario: v.id_morador_beneficiario,
      placa: v.placa ?? v.veiculo?.placa ?? null,
      inicio: v.inicio,
      fim: v.fim,
      titular_nome: v.titular?.nome ?? null,
      ocupante_nome:
        v.tipo_ocupacao === 'visitante'
          ? (v.visita?.pessoa?.nome ?? v.visitante?.nome ?? null)
          : v.tipo_ocupacao === 'inquilino'
            ? v.beneficiario?.nome ?? null
            : v.titular?.nome ?? null,
    };
  }

  async list(idCondominio: number, idApartamento: number) {
    const apto = await this.resolveApartamento(idCondominio, idApartamento);
    const moradores = await this.moradoresDoApto(apto);
    const moradorIds = moradores.map((m) => m.id);

    const [vagas, veiculosProprios] = await Promise.all([
      this.prisma.vagas.findMany({
        where: { id_apartamento: apto.id, ativo: 1 },
        include: {
          veiculo: true,
          visitante: true,
          visita: { include: { pessoa: true } },
          beneficiario: true,
          titular: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      moradorIds.length
        ? this.prisma.veiculos.findMany({
          where: { id_morador: { in: moradorIds }, ativo: 1 },
          orderBy: { created_at: 'desc' },
        })
        : Promise.resolve([]),
    ]);

    const proprios = veiculosProprios.map((v) => ({
      id: null,
      tipo_ocupacao: 'proprio',
      id_morador_titular: v.id_morador,
      id_veiculo: v.id,
      id_visitante: null,
      id_visita: null,
      id_morador_beneficiario: null,
      placa: v.placa ?? null,
      inicio: null,
      fim: null,
      titular_nome: moradores.find((m) => m.id === v.id_morador)?.nome ?? null,
      ocupante_nome: v.marca_modelo ?? null,
    }));

    const todas = [...proprios, ...vagas.map((v) => this.mapVaga(v))];
    return {
      qtd_vagas: apto.qtd_vagas ?? 0,
      ocupadas: todas.length,
      vagas: todas,
      moradores,
    };
  }

  /**
   * Beneficiários possíveis: visitantes do apto + moradores tipo Inquilino.
   *
   * Read-only nesta rodada de migração: `liberar()` (abaixo) continua
   * resolvendo `id_visitante` contra `Visitantes` incondicionalmente — fica
   * para uma rodada futura decidir o novo contrato de escrita. Só a leitura
   * migra aqui.
   */
  async beneficiarios(idCondominio: number, idApartamento: number) {
    const apto = await this.resolveApartamento(idCondominio, idApartamento);

    if (pessoasMigrationEnabled(this.prisma)) {
      const [visitasRaw, moradores] = await Promise.all([
        this.prisma.visitas.findMany({
          where: { id_apartamento: apto.id, is_visitante: 1 },
          select: {
            pessoa: { select: { id: true, nome: true, doc_identificacao: true, foto_pessoa: true } },
          },
          orderBy: { created_at: 'desc' },
        }),
        this.moradoresDoApto(apto),
      ]);

      // `Pessoas` já é deduplicada por identidade (@@unique([id_condominio,
      // doc_identificacao])) — diferente do legado, não precisa da heurística
      // de doc/nome/foto: uma pessoa só aparece uma vez, então dedup por
      // `pessoa.id` basta.
      const pessoasUnicas = new Map<number, { id: number; nome: string; doc_identificacao: string | null; foto_pessoa: string | null }>();
      for (const v of visitasRaw) {
        const p = v.pessoa;
        if (p && !pessoasUnicas.has(p.id)) pessoasUnicas.set(p.id, p);
      }
      const visitantesUnicos = Array.from(pessoasUnicas.values()).sort((a, b) =>
        (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
      );

      const inquilinos = moradores.filter((m) => (m.tipo ?? '').toLowerCase().includes('inquilino'));
      return {
        visitantes: visitantesUnicos.map((v) => ({
          id: v.id,
          nome: v.nome,
          doc_identificacao: v.doc_identificacao,
          tem_foto: !!(v.foto_pessoa && v.foto_pessoa.trim() !== ''),
        })),
        inquilinos: inquilinos.map((i) => ({ id: i.id, nome: i.nome })),
      };
    }

    const [visitantesRaw, moradores] = await Promise.all([
      this.prisma.visitantes.findMany({
        where: { id_apartamento: apto.id, is_visitante: 1 },
        select: { id: true, nome: true, doc_identificacao: true, foto_pessoa: true, created_at: true },
        orderBy: { created_at: 'desc' },
      }),
      this.moradoresDoApto(apto),
    ]);

    const mapUnicos = new Map<string, typeof visitantesRaw[0]>();
    for (const v of visitantesRaw) {
      const doc = (v.doc_identificacao ?? '').trim();
      const nome = (v.nome ?? '').trim().toLowerCase();
      const key = doc ? `doc:${doc}` : `nome:${nome}`;
      if (!mapUnicos.has(key)) {
        mapUnicos.set(key, v);
      } else {
        const existente = mapUnicos.get(key)!;
        const existenteTemFoto = !!(existente.foto_pessoa && existente.foto_pessoa.trim() !== '');
        const novoTemFoto = !!(v.foto_pessoa && v.foto_pessoa.trim() !== '');
        if (!existenteTemFoto && novoTemFoto) {
          mapUnicos.set(key, v);
        }
      }
    }

    const visitantesUnicos = Array.from(mapUnicos.values()).sort((a, b) =>
      (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
    );

    const inquilinos = moradores.filter((m) => (m.tipo ?? '').toLowerCase().includes('inquilino'));
    return {
      visitantes: visitantesUnicos.map((v) => ({
        id: v.id,
        nome: v.nome,
        doc_identificacao: v.doc_identificacao,
        tem_foto: !!(v.foto_pessoa && v.foto_pessoa.trim() !== ''),
      })),
      inquilinos: inquilinos.map((i) => ({ id: i.id, nome: i.nome })),
    };
  }

  async liberar(idCondominio: number, idApartamento: number, body: any) {
    if (!this.prisma.isConnected) throw new ServiceUnavailableException('Banco de dados indisponível.');
    const apto = await this.resolveApartamento(idCondominio, idApartamento);
    const moradores = await this.moradoresDoApto(apto);
    const moradorIds = moradores.map((m) => m.id);

    const idTitular = Number(body?.id_morador_titular) || null;
    if (!idTitular || !moradorIds.includes(idTitular)) {
      throw new BadRequestException('Selecione o morador titular (deste apartamento) da vaga.');
    }

    const tipo = (body?.tipo ?? '').toString();
    if (tipo !== 'visitante' && tipo !== 'inquilino') {
      throw new BadRequestException('Tipo de liberação inválido.');
    }

    const [ativas, veiculosProprios] = await Promise.all([
      this.prisma.vagas.count({ where: { id_apartamento: apto.id, ativo: 1 } }),
      moradorIds.length
        ? this.prisma.veiculos.count({ where: { id_morador: { in: moradorIds }, ativo: 1 } })
        : Promise.resolve(0),
    ]);
    if (ativas + veiculosProprios >= (apto.qtd_vagas ?? 0)) {
      throw new BadRequestException('Não há vagas livres neste apartamento.');
    }

    const inicio = body?.inicio ? new Date(body.inicio) : null;
    const fim = body?.fim ? new Date(body.fim) : null;
    const placa = body?.placa ? body.placa.toString().toUpperCase().trim() : null;

    let idVisitante: number | null = null;
    let idVisita: number | null = null;
    let idBeneficiario: number | null = null;

    if (tipo === 'visitante') {
      const idAlvo = Number(body?.id_visita ?? body?.id_pessoa ?? body?.id_visitante) || null;
      if (!idAlvo) throw new BadRequestException('Selecione um visitante cadastrado.');

      let visitaEncontrada: any = null;
      let visitanteLegado: any = null;

      if (pessoasMigrationEnabled(this.prisma)) {
        visitaEncontrada = await this.prisma.visitas.findFirst({
          where: {
            id_apartamento: apto.id,
            OR: [{ id: idAlvo }, { id_pessoa: idAlvo }],
          },
          orderBy: { created_at: 'desc' },
        });
        if (!visitaEncontrada) {
          visitanteLegado = await this.prisma.visitantes.findFirst({
            where: { id: idAlvo, id_apartamento: apto.id },
          });
        }
      } else {
        visitanteLegado = await this.prisma.visitantes.findFirst({
          where: { id: idAlvo, id_apartamento: apto.id },
        });
        if (!visitanteLegado) {
          visitaEncontrada = await this.prisma.visitas.findFirst({
            where: {
              id_apartamento: apto.id,
              OR: [{ id: idAlvo }, { id_pessoa: idAlvo }],
            },
            orderBy: { created_at: 'desc' },
          });
        }
      }

      if (!visitaEncontrada && !visitanteLegado) {
        throw new BadRequestException('Visitante não encontrado neste apartamento.');
      }

      if (visitaEncontrada) {
        if (visitaEncontrada.bloqueado === 1) {
          throw new BadRequestException(
            'Este visitante está bloqueado pela portaria. Fale com a portaria antes de liberar a vaga.',
          );
        }
        idVisita = visitaEncontrada.id;
        let pin = visitaEncontrada.codigo_acesso;
        if (!pin) {
          pin = Math.floor(100000 + Math.random() * 900000).toString();
        }
        await this.prisma.visitas.update({
          where: { id: visitaEncontrada.id },
          data: {
            liberado: 1,
            bloqueado: 0,
            data_entrada: null,
            data_saida: null,
            codigo_acesso: pin,
            ...(inicio ? { data_hora_inicio: inicio } : {}),
            ...(fim ? { data_hora_termino: fim } : {}),
          },
        });
      } else if (visitanteLegado) {
        idVisitante = visitanteLegado.id;
        let pin = visitanteLegado.codigo_acesso;
        if (!pin) {
          pin = Math.floor(100000 + Math.random() * 900000).toString();
        }
        await this.prisma.visitantes.update({
          where: { id: visitanteLegado.id },
          data: {
            liberado: 1,
            data_entrada: null,
            data_saida: null,
            codigo_acesso: pin,
            ...(inicio ? { data_hora_inicio: inicio } : {}),
            ...(fim ? { data_hora_termino: fim } : {}),
          },
        });
      }
    } else {
      idBeneficiario = Number(body?.id_morador_beneficiario) || null;
      if (!idBeneficiario || !moradorIds.includes(idBeneficiario)) {
        throw new BadRequestException('Selecione um inquilino deste apartamento.');
      }
    }

    const vaga = await this.prisma.vagas.create({
      data: {
        id_condominio: apto.id_condominio,
        id_apartamento: apto.id,
        id_morador_titular: idTitular,
        tipo_ocupacao: tipo,
        id_visitante: idVisitante,
        id_visita: idVisita,
        id_morador_beneficiario: idBeneficiario,
        id_veiculo: Number(body?.id_veiculo) || null,
        placa,
        inicio,
        fim,
      },
      include: {
        veiculo: true,
        visitante: true,
        visita: { include: { pessoa: true } },
        beneficiario: true,
        titular: true,
      },
    });

    const idParaSync = idVisita ?? idVisitante;
    if (idParaSync) {
      this.facial
        .syncVisitante(idParaSync)
        .catch((err) =>
          console.error('[vagas] falha ao sincronizar facial do visitante', idParaSync, err?.message),
        );
    }

    return this.mapVaga(vaga);
  }

  async revogar(idCondominio: number, idApartamento: number, id: number) {
    if (!this.prisma.isConnected) throw new ServiceUnavailableException('Banco de dados indisponível.');
    const apto = await this.resolveApartamento(idCondominio, idApartamento);
    const vaga = await this.prisma.vagas.findFirst({
      where: { id: Number(id), id_apartamento: apto.id, ativo: 1 },
    });
    if (!vaga) throw new BadRequestException('Vaga não encontrada.');

    // Revoga a vaga E o crachá/PIN por trás dela na mesma transação: sem isto
    // o rosto/PIN da Visita continuava liberando a portaria mesmo com a vaga
    // marcada como revogada — o botão "revogar" mentia para o morador.
    const updates: any[] = [this.prisma.vagas.update({ where: { id: vaga.id }, data: { ativo: 0 } })];
    if (vaga.tipo_ocupacao === 'visitante' && vaga.id_visita) {
      updates.push(
        this.prisma.visitas.update({
          where: { id: vaga.id_visita },
          data: { liberado: 0, codigo_acesso: null },
        }),
      );
    } else if (vaga.tipo_ocupacao === 'visitante' && vaga.id_visitante) {
      updates.push(
        this.prisma.visitantes.update({
          where: { id: vaga.id_visitante },
          data: { liberado: 0, codigo_acesso: null },
        }),
      );
    }
    await this.prisma.$transaction(updates);

    const idParaSync = vaga.id_visita ?? vaga.id_visitante;
    if (vaga.tipo_ocupacao === 'visitante' && idParaSync) {
      this.facial
        .syncVisitante(idParaSync)
        .catch((err) =>
          console.error('[vagas] falha ao reconciliar facial do visitante', idParaSync, err?.message),
        );
    }

    return { ok: true };
  }
}
