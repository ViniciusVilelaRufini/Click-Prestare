import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import {
  CreateVisitanteDto, VisitantesService,
} from './visitantes.service';

import { Throttle } from '@nestjs/throttler';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';
import { assertOperador } from '../auth/tenant.util';

/**
 * Superfície do CONSOLE (portaria-web). Enxerga o condomínio inteiro: todas
 * as visitas de todos os apartamentos, com nome, documento e foto.
 *
 * O TenantGuard protege pelo :idCondominio da rota — mas morador também
 * pertence ao condomínio, então ele sozinho não basta aqui. Sem o
 * assertOperador, qualquer morador autenticado listava os visitantes do
 * prédio inteiro e, pior, editava a identidade ou apagava as visitas de
 * qualquer pessoa cadastrada.
 *
 * O contraste estava explícito no próprio código: `findAllMobile`, que serve
 * o app, restringe TODO usuário (inclusive síndico) aos apartamentos a que
 * ele está vinculado, e o comentário lá diz que "ver todos" é exclusivo do
 * console web. Só que nada impunha esse "exclusivo" — a regra existia na
 * documentação e não no código.
 */
@Controller('condominios/:idCondominio/visitantes')
export class VisitantesController {
  constructor(private readonly service: VisitantesService) {}

  /** Achata a relação `apartamento` em `apto` / `apto_bloco` (compatível com o frontend antigo). */
  private flatten<T extends { apartamento?: { bloco: string | null; apto: string | null } | null }>(v: T) {
    const { apartamento, ...rest } = v;
    const formatDateTime = (date: any) => {
      if (!date) return null;
      const d = new Date(date);
      const pad = (n: number) => String(n).padStart(2, '0');
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };
    return {
      ...rest,
      apto: apartamento?.apto ?? null,
      apto_bloco: apartamento?.bloco ?? null,
      photo: (v as any).foto_pessoa ?? null,
      data_inicio: (v as any).data_hora_inicio ? formatDateTime((v as any).data_hora_inicio) : null,
      data_termino: (v as any).data_hora_termino ? formatDateTime((v as any).data_hora_termino) : null,
    };
  }

  @Get()
  async list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
    @Query('search') search?: string,
  ) {
    assertOperador(payload, 'listar os visitantes do condomínio');
    const list = await this.service.findAll(idCondominio, search);
    return list.map((v) => this.flatten(v));
  }

  /**
   * Lista pessoas únicas (agrupadas por documento/nome). Cada item
   * representa 1 pessoa, com agregados de todas as visitas. É a fonte
   * principal da página /visitantes.
   */
  @Get('pessoas')
  pessoas(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
    @Query('search') search?: string,
  ) {
    assertOperador(payload, 'listar as pessoas cadastradas no condomínio');
    return this.service.listarPessoas(idCondominio, search);
  }

  @Get(':id/detalhes')
  detalhes(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    // O service já confere o vínculo com o visitante; aqui é a camada de
    // papel — detalhes traz histórico completo, documento e fotos.
    assertOperador(payload, 'abrir os detalhes de um visitante');
    return this.service.detalhes(id, payload);
  }

  @Get('buscar/pessoa')
  buscarPessoa(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
    @Query('doc') doc?: string,
    @Query('nome') nome?: string,
  ) {
    // Busca por documento/nome em todo o condomínio: é consulta de portaria.
    assertOperador(payload, 'buscar pessoas no condomínio');
    return this.service.buscarPessoa(idCondominio, doc, nome);
  }

  /**
   * Cria uma nova visita para uma pessoa já cadastrada. Só pede apto +
   * validade — nome, foto, doc e face_id são copiados do registro de
   * referência. Endpoint do botão "Nova Visita" na lista.
   */
  @Post('pessoa/:idRef/nova-visita')
  novaVisitaPessoa(
    @Param('idRef', ParseIntPipe) idRef: number,
    @Body() body: {
      id_apartamento: number;
      data_hora_inicio?: string;
      data_hora_termino?: string;
    },
    @ReqUser() payload: JwtPayload,
  ) {
    // Copia identidade (nome, doc, foto, face_id) de um cadastro qualquer do
    // condomínio para uma visita nova. O create validado adiante já impede
    // apontar para apartamento alheio, mas escolher DE QUEM copiar é ação de
    // portaria.
    assertOperador(payload, 'criar nova visita a partir de um cadastro');
    return this.service.novaVisitaParaPessoa(idRef, body, payload);
  }

  /**
   * Atualiza dados de IDENTIDADE da pessoa em todos os seus registros
   * (nome, doc, fotos). Apartamento e datas pertencem a cada visita
   * individual e são editados por outro fluxo.
   */
  @SkipAudit()
  @Put('pessoa/:idRef')
  atualizarPessoa(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idRef', ParseIntPipe) idRef: number,
    @Body() body: {
      nome?: string;
      doc_identificacao?: string;
      foto_pessoa?: string;
      foto_documento?: string;
      is_visitante?: number;
      is_prestador?: number;
      tag_rfid?: string | null;
      dias_semana?: string;
      categorias?: string;
    },
    @ReqUser() payload: JwtPayload,
  ) {
    // Reescreve nome, documento, fotos e credencial RFID de uma pessoa em
    // TODAS as visitas dela. Sem checagem de papel, um morador reescrevia o
    // cadastro de qualquer visitante do prédio — incluindo a tag de acesso.
    assertOperador(payload, 'editar o cadastro de uma pessoa');
    return this.service.atualizarPessoa(idCondominio, idRef, body);
  }

  /**
   * Remove TODAS as visitas dessa pessoa no condomínio + desinscreve do
   * terminal facial. Endpoint do botão "Remover" da lista.
   */
  @SkipAudit()
  @Delete('pessoa/:idRef')
  removerPessoa(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Param('idRef', ParseIntPipe) idRef: number,
    @ReqUser() payload: JwtPayload,
  ) {
    // Apaga o cadastro e TODAS as visitas da pessoa. Era a rota mais exposta
    // do módulo: destrutiva, em massa, e alcançável por qualquer morador.
    assertOperador(payload, 'remover o cadastro de uma pessoa');
    return this.service.removerPessoa(idCondominio, idRef);
  }

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: Omit<CreateVisitanteDto, 'id_condominio'>,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.create({ ...body, id_condominio: idCondominio }, payload);
  }

  // PUT /:id e DELETE /:id foram removidos. Para atualizar identidade de
  // uma pessoa em todas as suas visitas, use PUT /pessoa/:idRef. Para
  // remover, use DELETE /pessoa/:idRef. Atualizações específicas de uma
  // visita ainda podem ser feitas via POST /visitantes/update (legacy,
  // usado pelo app Flutter).
}

@Controller('visitantes')
export class VisitantesGlobalController {
  constructor(private readonly service: VisitantesService) {}

  private flatten<T extends { apartamento?: { bloco: string | null; apto: string | null } | null }>(v: T) {
    const { apartamento, ...rest } = v;
    const formatDateTime = (date: any) => {
      if (!date) return null;
      const d = new Date(date);
      const pad = (n: number) => String(n).padStart(2, '0');
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };
    return {
      ...rest,
      apto: apartamento?.apto ?? null,
      apto_bloco: apartamento?.bloco ?? null,
      photo: (v as any).foto_pessoa ?? null,
      data_inicio: (v as any).data_hora_inicio ? formatDateTime((v as any).data_hora_inicio) : null,
      data_termino: (v as any).data_hora_termino ? formatDateTime((v as any).data_hora_termino) : null,
    };
  }

  // Rate-limit estrito: o PIN é só 6 dígitos (1M combinações). Sem limite,
  // um autenticado varre o espaço de PINs ativos. 10 tentativas/min/IP.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('validar/:codigo')
  async validarCodigo(
    @Param('codigo') codigo: string,
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
  ) {
    // Só pode validar PIN do próprio condomínio — senão dá pra varrer PINs
    // de qualquer prédio passando o id_condominio na query.
    await this.service.assertUsuarioNoCondominio(idCondominio, payload);
    // E só a portaria valida PIN: é o botão "Validar PIN" do console, que o
    // app nunca chama. Um acerto devolve o cadastro inteiro do visitante
    // (nome, documento, foto, apartamento de destino), então deixar morador
    // consultar entregava dado do vizinho a quem tivesse o código na mão.
    assertOperador(payload, 'validar PIN de acesso');
    return this.service.validarCodigo(idCondominio, codigo);
  }

  @SkipAudit()
  @Post('check-in')
  async checkIn(
    @Body('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.checkIn(id, payload);
  }

  @SkipAudit()
  @Post('liberar')
  async liberarAcesso(
    @Body('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.liberarAcesso(id, payload);
  }

  @SkipAudit()
  @Post('check-out')
  async checkOut(
    @Body('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.checkOut(id, payload);
  }

  // ===== Portaria remota — autorização em tempo real =====

  // Porteiro/portaria-web pede autorização ao morador (deixa pendente + push).
  @SkipAudit()
  @Post(':id/solicitar-autorizacao')
  async solicitarAutorizacao(
    @Param('id', ParseIntPipe) id: number,
    @Body('id_apartamento') idApartamento: number | string | undefined,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.solicitarAutorizacao(
      id,
      payload,
      idApartamento ? Number(idApartamento) : undefined,
    );
  }

  // Morador autoriza (libera acesso + facial).
  @SkipAudit()
  @Post(':id/autorizar')
  async autorizar(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.autorizar(id, payload);
  }

  // Morador nega (mantém bloqueado).
  @SkipAudit()
  @Post(':id/negar')
  async negar(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.negar(id, payload);
  }

  // Inbox do morador: solicitações pendentes dos seus apartamentos.
  @Get('pendentes')
  async pendentes(
    @Query('id_condominio') idCondominioStr: string | undefined,
    @ReqUser() payload: JwtPayload,
  ) {
    const idCondominio =
      idCondominioStr && idCondominioStr !== 'null' && idCondominioStr !== 'undefined'
        ? Number(idCondominioStr)
        : undefined;
    return this.service.listarPendentes(idCondominio, payload);
  }

  @Get('get')
  async getOne(
    @Query('id') id: string,
    @ReqUser() payload: JwtPayload,
  ) {
    const v = await this.service.findOne(Number(id), payload);
    return this.flatten(v);
  }

  @Get('get-all')
  async getAll(
    @Query('id_condominio') idCondominioStr: string | undefined,
    @Query('id_apto') idAptoStr: string | undefined,
    @Query('search') search: string | undefined,
    @Query('offset') offsetStr: string | undefined,
    @ReqUser() payload: JwtPayload,
  ) {
    const idCondominio = (idCondominioStr && idCondominioStr !== 'null' && idCondominioStr !== 'undefined')
      ? Number(idCondominioStr)
      : undefined;
    const idApto = idAptoStr ? Number(idAptoStr) : undefined;
    const offset = offsetStr ? Number(offsetStr) : 0;
    const userId = payload?.user?.id ?? payload?.sub;
    const userType = payload?.typeAccess ?? payload?.user?.typeAccess;

    const list = await this.service.findAllMobile(
      idCondominio,
      idApto,
      search,
      offset,
      userId ? Number(userId) : undefined,
      userType,
    );
    return list.map((v) => this.flatten(v));
  }

  @SkipAudit()
  @Post('insert')
  async insert(
    @Body() body: { id_condominio: string; visitante: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const idCondominio = Number(body.id_condominio);
    await this.service.assertUsuarioNoCondominio(idCondominio, payload);
    const vis = body.visitante;

    const saved = await this.service.create({
      nome: vis.nome,
      doc_identificacao: vis.doc_identificacao,
      data_hora_inicio: vis.data_inicio || vis.data_hora_inicio,
      data_hora_termino: vis.data_termino || vis.data_hora_termino,
      is_visitante: vis.is_visitante !== undefined ? Number(vis.is_visitante) : 1,
      is_prestador: vis.is_prestador !== undefined ? Number(vis.is_prestador) : 0,
      id_apartamento: Number(vis.id_apartamento),
      id_condominio: idCondominio,
      foto_documento: vis.foto_documento,
      foto_pessoa: vis.foto_pessoa || vis.photo,
      dias_semana: vis.dias_semana,
      id_anterior: vis.id_anterior ? Number(vis.id_anterior) : undefined,
      nome_anterior: vis.nome_anterior ? String(vis.nome_anterior) : undefined,
    }, payload);

    return saved;
  }

  /**
   * Excluir uma visita — o par do /prestadores/remove.
   *
   * O app chama esta rota desde sempre (`apiDeleteObject('visitantes', id)`),
   * mas ela não existia no controller: respondia 404 e o botão de excluir
   * visitante falhava em silêncio, porque o helper do app só olha o status.
   * Prestador tinha a rota; visitante, não.
   */
  @SkipAudit()
  @Post('remove')
  async remove(
    @Body('id', ParseIntPipe) id: number,
    @ReqUser() payload: JwtPayload,
  ) {
    return this.service.remove(id, payload);
  }

  @SkipAudit()
  @Post('update')
  async update(
    @Body() body: { id_condominio: string; visitante: any },
    @ReqUser() payload: JwtPayload,
  ) {
    const vis = body.visitante;

    return this.service.update({
      id: Number(vis.id),
      nome: vis.nome,
      doc_identificacao: vis.doc_identificacao,
      data_hora_inicio: vis.data_inicio || vis.data_hora_inicio,
      data_hora_termino: vis.data_termino || vis.data_hora_termino,
      is_visitante: vis.is_visitante !== undefined ? Number(vis.is_visitante) : undefined,
      is_prestador: vis.is_prestador !== undefined ? Number(vis.is_prestador) : undefined,
      id_apartamento: vis.id_apartamento ? Number(vis.id_apartamento) : undefined,
      foto_documento: vis.foto_documento,
      foto_pessoa: vis.foto_pessoa || vis.photo,
      dias_semana: vis.dias_semana,
    }, payload);
  }
}