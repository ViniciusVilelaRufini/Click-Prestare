import { Module } from '@nestjs/common';
import { ConvitesController } from './convites.controller';
import { ConvitesService } from './convites.service';
import { VisitantesModule } from '../visitantes/visitantes.module';

/**
 * Depende de `VisitantesModule` porque a confirmação cria o visitante pelo
 * `VisitantesService.create()` — é ele que herda foto e `face_id` de um CPF já
 * conhecido, evitando rosto duplicado no terminal facial.
 */
@Module({
  imports: [VisitantesModule],
  controllers: [ConvitesController],
  providers: [ConvitesService],
})
export class ConvitesModule {}
