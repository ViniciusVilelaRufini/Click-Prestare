import { Controller, Get, ForbiddenException } from '@nestjs/common';

/**
 * Leitura autenticada de objetos privados. A chave retornada pelos uploads n\u00e3o
 * \u00e9 um URL p\u00fablico: o cliente deve solicit\u00e1-la com o condom\u00ednio que est\u00e1 acessando.
 */
@Controller('storage')
export class StorageController {
  @Get('read')
  read(): never {
    throw new ForbiddenException(
      'Private object reads require an entity-to-tenant authorization mapping.',
    );
  }
}
