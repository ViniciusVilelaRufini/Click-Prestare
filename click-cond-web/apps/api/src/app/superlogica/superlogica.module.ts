import { Module } from '@nestjs/common';
import { SuperlogicaClient } from './superlogica.client';
import { SuperlogicaService } from './superlogica.service';

/**
 * Integração de leitura com o ERP Superlógica (taxa condominial).
 *
 * Sem controller por enquanto: nada é exposto por HTTP até existir a tela de
 * ativação no CRM. Exportado para o futuro serviço de sincronização.
 */
@Module({
  providers: [SuperlogicaClient, SuperlogicaService],
  exports: [SuperlogicaClient, SuperlogicaService],
})
export class SuperlogicaModule {}
