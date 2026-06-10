import { Global, Module } from '@nestjs/common';
import { TenantAccessService } from './tenant-access.service';

/**
 * Disponibiliza o TenantAccessService (autorização de tenant mobile-aware)
 * para qualquer módulo, sem precisar importar o AuthModule inteiro (que puxa
 * controllers e o OcorrenciasModule, criando risco de ciclo). É @Global porque
 * é uma dependência transversal de autorização, como o PrismaModule.
 */
@Global()
@Module({
  providers: [TenantAccessService],
  exports: [TenantAccessService],
})
export class TenantAccessModule {}
