import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';

/**
 * Visita sobre a qual uma nova liberação (Solicitar, Liberar, vaga) vai agir,
 * sem apagar histórico. Essas ações zeravam data_entrada/data_saida: numa
 * visita já USADA (entrou e saiu) isso sumia com a passagem real do registro;
 * numa visita EM CURSO (pessoa dentro) apagava a entrada de quem ainda está
 * no prédio.
 *  - pessoa dentro → recusa (dar baixa antes);
 *  - visita encerrada → cria uma visita nova, igual à antiga, sem entrada,
 *    saída nem PIN; a tag RFID migra para a nova, para a credencial resolver
 *    a visita ativa;
 *  - visita ainda não usada → a própria.
 */
export async function visitaParaNovaPassagem(prisma: any, ref: any): Promise<number> {
  if (ref.data_entrada && !ref.data_saida) {
    throw new BadRequestException(
      'Este visitante já está no condomínio. Dê baixa antes de registrar uma nova passagem.',
    );
  }
  if (!ref.data_entrada && !ref.data_saida) return Number(ref.id);

  const nova = await prisma.visitas.create({
    data: {
      id_pessoa: ref.id_pessoa,
      id_condominio: ref.id_condominio,
      id_apartamento: ref.id_apartamento,
      user: ref.user ?? null,
      is_visitante: ref.is_visitante,
      is_prestador: ref.is_prestador,
      data_hora_inicio: ref.data_hora_inicio,
      data_hora_termino: ref.data_hora_termino,
      data_entrada: null,
      data_saida: null,
      codigo_acesso: null,
      liberado: 0,
      bloqueado: ref.bloqueado ?? 0,
      avisar: ref.avisar ?? 1,
      tag_rfid: ref.tag_rfid ?? null,
      dias_semana: ref.dias_semana ?? null,
      categorias: ref.categorias ?? null,
    },
  });
  if (ref.tag_rfid) {
    await prisma.visitas.update({ where: { id: Number(ref.id) }, data: { tag_rfid: null } });
  }
  return nova.id;
}

/** PIN de 6 dígitos sem colisão com nenhuma visita/visitante em aberto. */
export async function gerarPinUnicoVisita(prisma: any): Promise<string> {
  for (;;) {
    const pin = randomInt(100000, 1000000).toString();
    const [emVisitas, emVisitantes] = await Promise.all([
      prisma.visitas.findFirst({ where: { codigo_acesso: pin, data_saida: null } }),
      prisma.visitantes.findFirst({ where: { codigo_acesso: pin, data_saida: null } }),
    ]);
    if (!emVisitas && !emVisitantes) return pin;
  }
}
