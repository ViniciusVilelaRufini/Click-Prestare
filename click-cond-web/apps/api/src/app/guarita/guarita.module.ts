import { Module } from '@nestjs/common';
import { FacialModule } from '../facial/facial.module';
import { GuaritaAgenteController } from './guarita-agente.controller';
import { GuaritaAgenteService } from './guarita-agente.service';
import { GuaritaController } from './guarita.controller';
import { GuaritaImportacaoService } from './guarita-importacao.service';

/**
 * Integração com o Módulo Guarita MG3000 (Nice / Linear-HCS) pelo Agente Local.
 * O aparelho é um Facial_Devices `tipo: 'guarita'`; seus dispositivos são Tags.
 * NÃO validado em aparelho: construído contra a referência do protocolo e o
 * simulador do agente.
 *
 * FacialModule: resolução do token do agente (FacialService.resolveAgente) e a
 * ponte de comandos (AgentBridgeService) para o relé.
 */
@Module({
  imports: [FacialModule],
  controllers: [GuaritaAgenteController, GuaritaController],
  providers: [GuaritaAgenteService, GuaritaImportacaoService],
  exports: [GuaritaAgenteService],
})
export class GuaritaModule {}
