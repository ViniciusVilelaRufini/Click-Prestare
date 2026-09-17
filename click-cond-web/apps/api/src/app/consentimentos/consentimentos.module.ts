import { Global, Module, forwardRef } from '@nestjs/common';
import { ConsentimentosController, ConsentimentosCondominioController } from './consentimentos.controller';
import { ConsentimentosService } from './consentimentos.service';
import { ConsentimentosTerceirosService } from './consentimentos-terceiros.service';
import { FacialModule } from '../facial/facial.module';

/**
 * Global porque o `VisitantesService` precisa consultar o consentimento de
 * biometria antes de enrolar um rosto no terminal — e essa checagem tem de
 * estar disponível em qualquer módulo que sincronize facial, sem criar
 * dependência circular.
 */
@Global()
@Module({
  // forwardRef porque o ciclo é real e intencional: o Facial pergunta ao
  // Consentimentos antes de enrolar, e o Consentimentos manda o Facial APAGAR
  // o rosto quando o titular revoga. Sem o segundo sentido, a revogação seria
  // decorativa — o rosto continuaria abrindo a portaria.
  imports: [forwardRef(() => FacialModule)],
  controllers: [ConsentimentosController, ConsentimentosCondominioController],
  providers: [ConsentimentosService, ConsentimentosTerceirosService],
  exports: [ConsentimentosService, ConsentimentosTerceirosService],
})
export class ConsentimentosModule {}
