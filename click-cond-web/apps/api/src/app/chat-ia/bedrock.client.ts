import { Injectable, Logger } from '@nestjs/common';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { credenciaisContaPrestare } from '../common/aws-credenciais.util';
import type {
  ChamadaFerramenta,
  ConteudoGemini,
  DeclaracaoFerramenta,
  RespostaGemini,
} from './gemini.client';

/**
 * Assistente IA via Amazon Bedrock, tudo dentro da conta AWS da Prestare:
 *  - Claude (Anthropic) → geração e function calling
 *  - Titan Text Embeddings V2 → embeddings do RAG de atas/documentos
 *
 * Existe para o produto contar como "deployed on AWS" no Marketplace (pré-
 * requisito da FTR / selo AWS Qualified Software). Mantém a interface do
 * GeminiClient, inclusive o formato de turnos (`ConteudoGemini`): o service
 * monta a conversa uma vez só e a tradução para a Messages API fica aqui.
 *
 * Região sa-east-1 com perfil `global.`: a requisição entra em São Paulo e a
 * AWS roteia para onde houver capacidade. Os modelos 5.x ainda não estão
 * liberados para a conta (02/11/2026) — quando forem, é só trocar
 * BEDROCK_MODELO_IA, sem deploy.
 */
const REGIAO = process.env['BEDROCK_REGIAO'] || 'sa-east-1';
const MODELO = process.env['BEDROCK_MODELO_IA'] || 'global.anthropic.claude-sonnet-4-6';
const MODELO_EMBED = 'amazon.titan-embed-text-v2:0';
/** Titan v2 aceita 256, 512 ou 1024. 512 mantém o ranking em memória leve. */
export const DIMENSOES_EMBED_BEDROCK = 512;
/**
 * Inclui o raciocínio (thinking adaptativo) além da resposta. O teto do
 * Gemini era 4096 só de texto; com o thinking junto, 4096 cortaria respostas.
 */
const MAX_TOKENS = 16000;
const ESFORCO = (process.env['BEDROCK_ESFORCO_IA'] || 'medium') as 'low' | 'medium' | 'high';
/** O Titan não tem endpoint em lote; paraleliza sem estourar a cota. */
const EMBED_CONCORRENCIA = 4;

const IMAGENS = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * Converte o schema do formato do Gemini (OpenAPI, `type` em maiúsculas como
 * 'STRING') para JSON Schema, que é o que a Messages API valida.
 */
export function paraJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(paraJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(schema as Record<string, unknown>)) {
    saida[chave] = chave === 'type' && typeof valor === 'string' ? valor.toLowerCase() : paraJsonSchema(valor);
  }
  return saida;
}

export function paraFerramentas(declaracoes: DeclaracaoFerramenta[]): Tool[] {
  return declaracoes.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: (d.parameters
      ? paraJsonSchema(d.parameters)
      : { type: 'object', properties: {} }) as Tool['input_schema'],
  }));
}

function parteDoUsuario(p: any): ContentBlockParam | null {
  if (typeof p?.text === 'string') return p.text.trim() ? { type: 'text', text: p.text } : null;
  const dado = p?.inlineData;
  if (dado?.data && dado?.mimeType) {
    if (IMAGENS.has(dado.mimeType)) {
      return { type: 'image', source: { type: 'base64', media_type: dado.mimeType, data: dado.data } };
    }
    if (dado.mimeType === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dado.data } };
    }
    return { type: 'text', text: `[Anexo em formato não suportado: ${dado.mimeType}]` };
  }
  return null;
}

/**
 * Turnos no formato do Gemini → mensagens da Messages API.
 *
 * O turno do modelo volta do service exatamente como `partesModelo` o
 * entregou (`{ _bloco }`), e assim é reenviado: com thinking ligado, o
 * tool_use precisa ir junto do bloco de raciocínio que o antecedeu, intacto.
 *
 * O Gemini casa resposta de ferramenta por nome/ordem; o Claude exige o id do
 * tool_use. O service devolve os resultados na mesma ordem das chamadas, então
 * o id sai da fila de tool_use do turno anterior.
 */
export function paraMensagens(contents: ConteudoGemini[]): MessageParam[] {
  const mensagens: MessageParam[] = [];
  let idsPendentes: string[] = [];

  for (const turno of contents) {
    if (turno.role === 'model') {
      const blocos = (turno.parts ?? [])
        .map((p: any): ContentBlockParam | null =>
          p?._bloco ? (p._bloco as ContentBlockParam) : parteDoUsuario(p),
        )
        .filter((b): b is ContentBlockParam => !!b);
      idsPendentes = blocos.filter((b) => b.type === 'tool_use').map((b: any) => b.id);
      if (blocos.length) mensagens.push({ role: 'assistant', content: blocos });
      continue;
    }

    const blocos: ContentBlockParam[] = [];
    for (const p of turno.parts ?? []) {
      if (p?.functionResponse) {
        const id = idsPendentes.shift();
        if (!id) continue;
        blocos.push({
          type: 'tool_result',
          tool_use_id: id,
          content: JSON.stringify(p.functionResponse.response?.result ?? p.functionResponse.response ?? null),
        });
        continue;
      }
      const b = parteDoUsuario(p);
      if (b) blocos.push(b);
    }
    if (blocos.length) mensagens.push({ role: 'user', content: blocos });
  }
  return mensagens;
}

export function daResposta(content: ContentBlock[], stopReason: string | null): RespostaGemini {
  if (stopReason === 'refusal') {
    return { texto: 'Não posso ajudar com esse pedido.', chamadas: [], partesModelo: [] };
  }
  const texto = content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const chamadas: ChamadaFerramenta[] = content
    .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    .map((b) => ({ name: b.name, args: (b.input ?? {}) as Record<string, any> }));
  return { texto, chamadas, partesModelo: content.map((b) => ({ _bloco: b })) };
}

@Injectable()
export class BedrockClient {
  private readonly logger = new Logger(BedrockClient.name);
  private claude?: AnthropicBedrock;
  private runtime?: BedrockRuntimeClient;

  /** Sem chave a configurar: a permissão vem do role da instância. */
  get isConfigured(): boolean {
    return true;
  }

  private cliente(): AnthropicBedrock {
    this.claude ??= new AnthropicBedrock({
      awsRegion: REGIAO,
      providerChainResolver: async () => credenciaisContaPrestare(),
    });
    return this.claude;
  }

  private bedrockRuntime(): BedrockRuntimeClient {
    this.runtime ??= new BedrockRuntimeClient({ region: REGIAO, credentials: credenciaisContaPrestare() });
    return this.runtime;
  }

  async embedText(texto: string): Promise<number[]> {
    const r = await this.bedrockRuntime().send(
      new InvokeModelCommand({
        modelId: MODELO_EMBED,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: texto, dimensions: DIMENSOES_EMBED_BEDROCK, normalize: true }),
      }),
    );
    const corpo = JSON.parse(new TextDecoder().decode(r.body));
    return corpo?.embedding ?? [];
  }

  async embedBatch(textos: string[]): Promise<number[][]> {
    const saida: number[][] = new Array(textos?.length ?? 0);
    for (let i = 0; i < saida.length; i += EMBED_CONCORRENCIA) {
      const lote = textos.slice(i, i + EMBED_CONCORRENCIA);
      const vetores = await Promise.all(lote.map((t) => this.embedText(t)));
      vetores.forEach((v, j) => (saida[i + j] = v));
    }
    return saida;
  }

  async gerarComFerramentas(
    contents: ConteudoGemini[],
    ferramentas: DeclaracaoFerramenta[],
    instrucaoSistema?: string,
  ): Promise<RespostaGemini> {
    const r = await this.cliente().messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: ESFORCO },
      ...(instrucaoSistema && { system: instrucaoSistema }),
      ...(ferramentas.length > 0 && { tools: paraFerramentas(ferramentas) }),
      messages: paraMensagens(contents),
    });
    if (r.stop_reason === 'max_tokens') this.logger.warn('resposta cortada por max_tokens');
    return daResposta(r.content, r.stop_reason);
  }
}
