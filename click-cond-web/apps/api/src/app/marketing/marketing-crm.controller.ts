import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingLeadsService } from './marketing-leads.service';
import { MarketingResumoService } from './marketing-resumo.service';
import { diaBrt, fimDiaBrt, inicioDiaBrt } from './datas-brt';

// 'de'/'ate' chegam como YYYY-MM-DD (filtro do CRM) e viram início/fim do dia
// em BRT (America/Sao_Paulo, UTC-3), não UTC — servidor roda em UTC mas quem
// filtra pensa em dia local. Uma string ISO completa (com 'T') é aceita como
// veio, sem reinterpretar o horário.
function dataInicio(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = v.includes('T') ? new Date(v) : inicioDiaBrt(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function dataFim(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = v.includes('T') ? new Date(v) : fimDiaBrt(v);
  return isNaN(d.getTime()) ? undefined : d;
}

@Controller('crm/marketing')
@UseGuards(CrmAdminGuard)
export class MarketingCrmController {
  constructor(private readonly leads: MarketingLeadsService, private readonly resumoSvc: MarketingResumoService) {}

  @Get('leads')
  listar(@Query('status') status?: string, @Query('origem') origem?: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.leads.listar({ status, origem, de: dataInicio(de), ate: dataFim(ate) });
  }

  @Patch('leads/:id')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: string; observacao?: string }) {
    return this.leads.atualizar(id, body ?? {});
  }

  @Delete('leads/:id')
  removerOrganico(@Param('id', ParseIntPipe) id: number) {
    return this.leads.removerOrganico(id);
  }

  @Get('resumo')
  resumo(@Query('de') de?: string, @Query('ate') ate?: string) {
    const fim = dataFim(ate) ?? fimDiaBrt(diaBrt(new Date()));
    const inicio = dataInicio(de) ?? inicioDiaBrt(diaBrt(new Date(fim.getTime() - 29 * 24 * 60 * 60 * 1000)));
    return this.resumoSvc.resumo(inicio, fim);
  }
}
