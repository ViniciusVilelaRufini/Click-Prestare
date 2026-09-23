import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UsuarioAppGuard } from './usuario-app.guard';
import * as mobile from './mobile-auth.controller';
import { ChatIaController } from '../chat-ia/chat-ia.controller';
import { AgendaController } from '../agenda/agenda.controller';
import { ComunicadosMobileController } from '../comunicados/comunicados-mobile.controller';
import { ContatosController } from '../contatos/contatos.controller';
import { MudancasController } from '../mudancas/mudancas.controller';
import { PrestadoresMobileController } from '../prestadores/prestadores-mobile.controller';
import { ConsentimentosController, ConsentimentosCondominioController } from '../consentimentos/consentimentos.controller';
import { ConvitesController } from '../convites/convites.controller';
import { VisitantesGlobalController } from '../visitantes/visitantes.controller';

/**
 * Rotas do app tomam `payload.sub` como Users.id. O `sub` do porteiro da
 * portaria-web (Funcionarios_Portaria.id) e o do CRM (crm_admins.id) agiam
 * como o usuário de mesmo número — lendo extrato, revogando biometria,
 * listando visitas e PINs de outra pessoa. A trava vale para todo controller
 * exclusivo do app; os que a portaria-web também usa ficam de fora (e tratam
 * o token com idUsuarioDoToken).
 */
const guardas = (Classe: any): any[] => Reflect.getMetadata(GUARDS_METADATA, Classe) ?? [];

describe('UsuarioAppGuard — cobertura dos controllers do app', () => {
  const doApp = [
    ...Object.values(mobile).filter((c: any) => typeof c === 'function' && /Controller$/.test(c.name)),
    ChatIaController,
    AgendaController,
    ComunicadosMobileController,
    ContatosController,
    MudancasController,
    PrestadoresMobileController,
    ConsentimentosController,
    ConvitesController,
  ] as any[];

  it.each(doApp.map((c) => [c.name, c]))('%s exige token de usuário do app', (_nome, Classe) => {
    expect(guardas(Classe)).toContain(UsuarioAppGuard);
  });

  it.each([
    ['ConsentimentosCondominioController', ConsentimentosCondominioController],
    ['VisitantesGlobalController', VisitantesGlobalController],
  ])('%s (usado pela portaria-web) não recusa o token do porteiro', (_nome, Classe) => {
    expect(guardas(Classe)).not.toContain(UsuarioAppGuard);
  });
});
