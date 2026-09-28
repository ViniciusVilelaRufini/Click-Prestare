import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { CrmAdminGuard } from '../crm/crm-admin.guard';
import { MarketingLeadsService } from './marketing-leads.service';

function data(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

@Controller('crm/marketing')
@UseGuards(CrmAdminGuard)
export class MarketingCrmController {
  constructor(private readonly leads: MarketingLeadsService) {}

  @Get('leads')
  listar(@Query('status') status?: string, @Query('origem') origem?: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.leads.listar({ status, origem, de: data(de), ate: data(ate) });
  }

  @Patch('leads/:id')
  atualizar(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: string; observacao?: string }) {
    return this.leads.atualizar(id, body ?? {});
  }
}
