import { BadRequestException } from '@nestjs/common';
import { pessoasMigrationEnabled } from './pessoas-migration.util';
import { variantesCodigoTag } from './tag-codigo.util';

/**
 * Visita/visitante que ainda vale como dono de uma tag: não teve a saída
 * registrada, ou teve e segue liberado (prestador recorrente). A tag de
 * visitante é devolvida e reaproveitada — a visita encerrada não é mais dona.
 *
 * É um filtro `OR` do Prisma; vale para `Visitantes` e para `Visitas`.
 */
export const VISITA_NAO_ENCERRADA: Array<{ data_saida: null } | { liberado: number }> = [
  { data_saida: null },
  { liberado: 1 },
];

export const MSG_TAG_EM_USO = 'Esta tag já está cadastrada para outra pessoa ou veículo.';

export interface TagEmUsoOpcoes {
  /** O próprio registro que está sendo gravado — não conta como conflito. */
  ignorar?: {
    /** `Tags.id` (a própria tag do veículo). */
    idTag?: number | null;
    /** `Moradores.id`. */
    idMorador?: number | null;
    /** `Visitantes.id` — todos os registros da mesma pessoa (legado). */
    idsVisitantes?: number[];
    /** `Visitas.id_pessoa` — as visitas da mesma pessoa (migrado). */
    idPessoa?: number | null;
  };
  /**
   * Tabela de visitas a conferir. Padrão: a da flag de migração (a mesma que a
   * leitura do leitor consulta).
   */
  tabelaVisitas?: 'visitas' | 'visitantes';
}

/**
 * Unicidade de tag no CADASTRO, por variantes.
 *
 * A leitura do leitor casa o código por variantes (decimal x hex x Wiegand com
 * separador — ver `gruposCodigoTag`). Se o cadastro conferisse só o texto
 * exato, e só a própria tabela, a mesma tag física entrava duas vezes em
 * formatos diferentes ("12345678" x "BC614E"): quem cadastrou por último
 * passava a ser registrado no lugar do dono, ou os dois ficavam negados por
 * ambiguidade.
 *
 * Recusa quando QUALQUER variante do código já existe, no mesmo condomínio, em
 * `Tags` (qualquer estado — a bloqueada continua ocupando o código), em
 * `Moradores.tag_rfid` ou em visita/visitante não encerrado.
 */
export async function assertTagNaoEmUso(
  prisma: any,
  idCondominio: number,
  codigo: unknown,
  opts: TagEmUsoOpcoes = {},
): Promise<void> {
  const variantes = variantesCodigoTag(codigo);
  if (variantes.length === 0) return;
  const ignorar = opts.ignorar ?? {};
  const recusar = () => {
    throw new BadRequestException(MSG_TAG_EM_USO);
  };

  const emTag = await prisma.tags.findFirst({
    where: {
      id_condominio: idCondominio,
      codigo: { in: variantes },
      ...(ignorar.idTag != null ? { id: { not: Number(ignorar.idTag) } } : {}),
    },
    select: { id: true },
  });
  if (emTag) recusar();

  const emMorador = await prisma.moradores.findFirst({
    where: {
      id_condominio: idCondominio,
      tag_rfid: { in: variantes },
      ...(ignorar.idMorador != null ? { id: { not: Number(ignorar.idMorador) } } : {}),
    },
    select: { id: true },
  });
  if (emMorador) recusar();

  const tabela =
    opts.tabelaVisitas ?? (pessoasMigrationEnabled(prisma) ? 'visitas' : 'visitantes');
  const whereVisita = {
    id_condominio: idCondominio,
    tag_rfid: { in: variantes },
    OR: VISITA_NAO_ENCERRADA,
  };
  const emVisita =
    tabela === 'visitas'
      ? await prisma.visitas.findFirst({
          where: {
            ...whereVisita,
            ...(ignorar.idPessoa != null ? { id_pessoa: { not: Number(ignorar.idPessoa) } } : {}),
          },
          select: { id: true },
        })
      : await prisma.visitantes.findFirst({
          where: {
            ...whereVisita,
            ...(ignorar.idsVisitantes?.length ? { id: { notIn: ignorar.idsVisitantes } } : {}),
          },
          select: { id: true },
        });
  if (emVisita) recusar();
}
