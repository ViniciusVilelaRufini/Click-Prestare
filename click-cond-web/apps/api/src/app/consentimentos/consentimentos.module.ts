import { Global, Module } from '@nestjs/common';
import { ConsentimentosController } from './consentimentos.controller';
import { ConsentimentosService } from './consentimentos.service';

/**
 * Global porque o `VisitantesService` precisa consultar o consentimento de
 * biometria antes de enrolar um rosto no terminal — e essa checagem tem de
 * estar disponível em qualquer módulo que sincronize facial, sem criar
 * dependência circular.
 */
@Global()
@Module({
  controllers: [ConsentimentosController],
  providers: [ConsentimentosService],
  exports: [ConsentimentosService],
})
export class ConsentimentosModule {}
