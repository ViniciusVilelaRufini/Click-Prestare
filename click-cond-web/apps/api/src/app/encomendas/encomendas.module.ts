import { Module } from '@nestjs/common';
import { EncomendasController } from './encomendas.controller';
import { EncomendasService } from './encomendas.service';
import { IaClient } from '../chat-ia/ia.client';
import { BedrockClient } from '../chat-ia/bedrock.client';
import { GeminiClient } from '../chat-ia/gemini.client';

@Module({
  controllers: [EncomendasController],
  providers: [EncomendasService, IaClient, BedrockClient, GeminiClient],
  exports: [EncomendasService],
})
export class EncomendasModule {}
