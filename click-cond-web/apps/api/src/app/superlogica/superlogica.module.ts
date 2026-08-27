import { Module } from '@nestjs/common';
import { SuperlogicaClient } from './superlogica.client';
import { SuperlogicaService } from './superlogica.service';
import { SuperlogicaSyncService } from './superlogica-sync.service';
import { MoradoresModule } from '../moradores/moradores.module';

/**
 * Integração de leitura com o ERP Superlógica (taxa condominial).
 *
 * Sem controller por enquanto: nada é exposto por HTTP até existir a tela de
 * ativação no CRM. Exportado para o futuro serviço de sincronização.
 */
@Module({
  // MoradoresModule: a importação de contatos passa pelo cadastro oficial de
  // morador, que é quem cria o Users e o vínculo em Apartamentos_Users.
  imports: [MoradoresModule],
  providers: [SuperlogicaClient, SuperlogicaService, SuperlogicaSyncService],
  exports: [SuperlogicaClient, SuperlogicaService, SuperlogicaSyncService],
})
export class SuperlogicaModule {}
