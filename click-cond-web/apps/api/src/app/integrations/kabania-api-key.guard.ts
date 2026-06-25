import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class KabaniaApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    
    const configuredApiKey = process.env.KABANIA_API_KEY;
    
    // Se a chave de API não estiver configurada no .env, bloqueia por segurança
    if (!configuredApiKey) {
      throw new UnauthorizedException('Chave de API de integração não configurada no servidor.');
    }
    
    if (apiKey === configuredApiKey) {
      return true;
    }
    
    throw new UnauthorizedException('Chave de API inválida ou não fornecida.');
  }
}
