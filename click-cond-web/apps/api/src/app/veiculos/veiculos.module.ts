import { Module } from '@nestjs/common';
import { VeiculosController } from './veiculos.controller';
import { VeiculosService } from './veiculos.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  controllers: [VeiculosController, TagsController],
  providers: [VeiculosService, TagsService],
})
export class VeiculosModule {}
