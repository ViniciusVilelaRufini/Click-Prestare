import { Module } from '@nestjs/common';
import { GuaritaOperacoesService } from './guarita-operacoes.service';

/**
 * Núcleo do Módulo Guarita: a fila de gravação (GuaritaOperacoesService), que
 * só depende do Prisma (global). Veículos, Moradores e o app (AuthModule)
 * importam este módulo — sem puxar o FacialModule, e sem ciclo.
 */
@Module({
  providers: [GuaritaOperacoesService],
  exports: [GuaritaOperacoesService],
})
export class GuaritaNucleoModule {}
