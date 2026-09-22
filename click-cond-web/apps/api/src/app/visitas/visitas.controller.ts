import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { VisitasService } from './visitas.service';
import { ReqUser } from '../auth/req-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { assertOperador } from '../auth/tenant.util';

/**
 * Como em `visitantes.controller.ts`: o TenantGuard só confere o
 * `:idCondominio` da rota, e um morador legitimamente pertence ao
 * condomínio dele — então o guard sozinho não impede um morador autenticado
 * de listar presença/visitas do condomínio inteiro. `assertOperador` é quem
 * fecha isso.
 *
 * Só rotas de LEITURA aqui de propósito. As de escrita (criar visita,
 * registrar entrada/saída) foram removidas numa auditoria: nenhum cliente
 * (app ou portaria-web) as chamava, e elas expunham `VisitasService.criarVisita`/
 * `registrarEntrada`/`registrarSaida` — primitivas de baixo nível — direto por
 * HTTP, sem as checagens que o caminho de verdade (`VisitantesService`,
 * `visitantes.service.ts:1189-1271`) sempre faz ANTES de chamá-las: permissão
 * granular de funcionário, pessoa bloqueada, PIN único, desativação de outros
 * códigos, auditoria e — no checkout — a revogação de fato do rosto/PIN no
 * terminal. Reexpor essas rotas exige portar as mesmas checagens antes.
 */
@Controller('condominios/:idCondominio/visitas')
export class VisitasController {
  constructor(private readonly service: VisitasService) {}

  @Get('presenca')
  async listarPresenca(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'ver quem está presente no condomínio');
    return this.service.listarPresenca(idCondominio);
  }

  @Get()
  async listar(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @ReqUser() payload: JwtPayload,
  ) {
    assertOperador(payload, 'listar as visitas do condomínio');
    return this.service.listarVisitasCondominio(idCondominio);
  }
}
