import { Module } from '@nestjs/common';
import { VeiculosController } from './veiculos.controller';
import { VeiculosService } from './veiculos.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { GuaritaNucleoModule } from '../guarita/guarita-nucleo.module';

@Module({
  // Módulo Guarita: editar/excluir veículo ou tag enfileira a operação no Guarita.
  imports: [GuaritaNucleoModule],
  controllers: [VeiculosController, TagsController],
  providers: [VeiculosService, TagsService],
})
export class VeiculosModule {}
