import { Module } from '@nestjs/common';
import { ChatIaController } from './chat-ia.controller';
import { ChatIaService } from './chat-ia.service';
import { GeminiClient } from './gemini.client';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantAccessModule } from '../auth/tenant-access.module';

@Module({
  imports: [PrismaModule, TenantAccessModule],
  controllers: [ChatIaController],
  providers: [ChatIaService, GeminiClient],
})
export class ChatIaModule {}
