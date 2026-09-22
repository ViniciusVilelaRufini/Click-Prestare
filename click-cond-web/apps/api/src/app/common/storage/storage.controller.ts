import { Controller, Get, NotFoundException, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReqUser } from '../../auth/req-user.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.interface';
import { TenantAccessService } from '../../auth/tenant-access.service';
import { StorageService } from './storage.service';

/**
 * Leitura autenticada de objetos privados. A chave retornada pelos uploads n\u00e3o
 * \u00e9 um URL p\u00fablico: o cliente deve solicit\u00e1-la com o condom\u00ednio que est\u00e1 acessando.
 */
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  @Get('read')
  async read(
    @Query('key') key: string,
    @Query('id_condominio', ParseIntPipe) idCondominio: number,
    @ReqUser() user: JwtPayload,
    @Res() response: Response,
  ): Promise<void> {
    await this.tenantAccess.assertCondominio(idCondominio, user);
    const object = await this.storage.getPrivateObject(key);
    const body = object.Body as { pipe?: (destination: Response) => unknown } | undefined;
    if (!body?.pipe) throw new NotFoundException('Private object was not found.');

    response.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
    if (object.ContentLength != null) response.setHeader('Content-Length', String(object.ContentLength));
    body.pipe(response);
  }
}
