import { Controller, Get, UseGuards } from '@nestjs/common';
import { KabaniaService } from './kabania.service';
import { KabaniaApiKeyGuard } from './kabania-api-key.guard';
import { Public } from '../auth/public.decorator';

@Controller('integrations/kabania')
export class KabaniaController {
  constructor(private readonly kabaniaService: KabaniaService) {}

  @Public()
  @UseGuards(KabaniaApiKeyGuard)
  @Get('sync-data')
  async getSyncData() {
    return this.kabaniaService.getSyncData();
  }
}
