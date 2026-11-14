import { Module } from '@nestjs/common';
import { CredenciaisValidacaoService } from './credenciais-validacao.service';

/**
 * Núcleo da credencial dinâmica: só a validação de leitura. Fica separado do
 * CredenciaisModule porque o FacialModule precisa dela e o VisitantesModule
 * (importado pelo CredenciaisModule) importa o FacialModule. Não importar
 * VisitantesModule nem FacialModule aqui. O PrismaModule é global.
 */
@Module({
  providers: [CredenciaisValidacaoService],
  exports: [CredenciaisValidacaoService],
})
export class CredenciaisNucleoModule {}
