import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { TagDto, TagsService } from './tags.service';
import { SkipAudit } from '../common/interceptors/skip-audit.decorator';

@Controller('condominios/:idCondominio/tags')
export class TagsController {
  constructor(private readonly service: TagsService) {}

  @Get()
  list(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Query('livres') livres?: string,
  ) {
    return this.service.findAll(idCondominio, livres === 'true');
  }

  @SkipAudit()
  @Post()
  create(
    @Param('idCondominio', ParseIntPipe) idCondominio: number,
    @Body() body: TagDto,
  ) {
    return this.service.upsert(idCondominio, body);
  }
}
