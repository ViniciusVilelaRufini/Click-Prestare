import { JwtService } from '@nestjs/jwt';
import { json, text, urlencoded } from 'express';

/**
 * Teto do corpo JSON/urlencoded por rota (pentest P-06).
 *
 * O parser roda ANTES de qualquer guard e materializa o corpo inteiro em
 * memória. Com 100 MB para todo mundo, poucos IPs sem conta pressionavam a
 * memória da instância. Agora:
 *
 *  - padrão: 2 MB;
 *  - foto em rota pública (signup do síndico, convite preenchido por link):
 *    6 MB, os 5 MB de foto em base64 que esses fluxos já aceitam + o resto;
 *  - Agente Local e webhook do aparelho (snapshot da câmera, evento): 10 MB,
 *    o mesmo teto que o XML da Hikvision já tinha;
 *  - rotas que recebem arquivo em base64 (fotos, documentos, comprovantes,
 *    PDF do chat IA): 35 MB, que cobre os 25 MB decodificados do
 *    StorageService (base64 cresce 4/3) — e SÓ com um JWT de assinatura
 *    válida e não vencido no Authorization. Sem token, a faixa é o padrão e o
 *    guard responde 401 normalmente para corpos pequenos.
 *
 * A checagem do JWT aqui só escolhe o teto; a autorização de verdade continua
 * no JwtAuthGuard (revogação por troca de senha, porteiro desligado etc.).
 *
 * Rota nova que recebe base64 grande precisa entrar em ROTAS_UPLOAD, senão o
 * cliente recebe 413. O ideal a médio prazo é upload direto ao S3 por URL
 * assinada, e esta lista encolher.
 */
export const LIMITE_PADRAO = 2 * 1024 * 1024;
export const LIMITE_PUBLICO_FOTO = 6 * 1024 * 1024;
export const LIMITE_HARDWARE = 10 * 1024 * 1024;
export const LIMITE_UPLOAD = 35 * 1024 * 1024;

const METODOS_COM_CORPO = new Set(['POST', 'PUT', 'PATCH']);

/** Públicas que recebem foto. Validam tipo e tamanho da foto no serviço. */
const ROTAS_PUBLICAS_FOTO = [/^\/api\/sindico\/signup$/, /^\/api\/convites\/publico\/[^/]+$/];

/** Agente Local (resultado de comando, evento) e push do aparelho. */
const ROTAS_HARDWARE = [
  /^\/api\/facial\/webhook\/[^/]+$/,
  /^\/api\/facial\/agent\/[^/]+\/result$/,
  /^\/api\/facial\/agent\/condo\/[^/]+\/(result|event)$/,
];

/**
 * Recursos que recebem arquivo em base64 no corpo (StorageService.uploadDataUrl
 * ou coluna com data URL). Levantado em 2026-11-04 a partir dos chamadores de
 * uploadDataUrl/isDataUrl e dos DTOs com foto/anexo/arquivo.
 */
const ROTAS_UPLOAD = [
  // superfície mobile (mobile-auth) e controllers globais
  /^\/api\/(sindico|moradores|funcionarios|condominio|ocorrencias|encomendas|visitantes|prestadores|convites|documentos|assembleias|financeiro|areasSociais|areas-sociais|chat-ia|delivery)(\/|$)/,
  // REST da portaria-web, por condomínio
  /^\/api\/condominios\/[^/]+\/(moradores|visitantes|prestadores|pessoas|encomendas|ocorrencias)(\/|$)/,
];

function bearer(req: any): string | null {
  const h = req.headers?.['authorization'];
  if (typeof h !== 'string' || !h) return null;
  return h.startsWith('Bearer ') ? h.substring(7) : h;
}

const verificadores = new Map<string, JwtService>();
function jwtAssinadoValido(token: string, segredo: string): boolean {
  let v = verificadores.get(segredo);
  if (!v) {
    v = new JwtService({ secret: segredo });
    verificadores.set(segredo, v);
  }
  try {
    v.verify(token, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

/** Teto em bytes do corpo desta requisição. */
export function faixaDoCorpo(req: any, segredoJwt: string): number {
  if (!METODOS_COM_CORPO.has(String(req.method).toUpperCase())) return LIMITE_PADRAO;
  const caminho = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  if (ROTAS_PUBLICAS_FOTO.some((r) => r.test(caminho))) return LIMITE_PUBLICO_FOTO;
  if (ROTAS_HARDWARE.some((r) => r.test(caminho))) return LIMITE_HARDWARE;
  if (ROTAS_UPLOAD.some((r) => r.test(caminho))) {
    const token = bearer(req);
    if (token && jwtAssinadoValido(token, segredoJwt)) return LIMITE_UPLOAD;
  }
  return LIMITE_PADRAO;
}

/** O webhook do WhatsApp confere o HMAC sobre o corpo exato: só ele guarda a cópia bruta. */
const guardarCorpoBruto = (req: any, _res: unknown, buf: Buffer) => {
  if (req.originalUrl?.startsWith('/api/public/whatsapp')) req.rawBody = buf;
};

/** Câmeras Hikvision postam o evento em XML (não JSON); o webhook converte em webhook-payload.util. */
const ROTA_XML = /^\/api\/facial\/webhook\//;

type Middleware = (req: any, res: any, next: (err?: unknown) => void) => void;

/**
 * Middleware único de corpo (substitui o bodyParser do Nest, desligado no
 * main.ts). Escolhe a faixa por requisição e roda json → urlencoded (→ xml no
 * webhook do aparelho) daquela faixa.
 */
export function parserDeCorpo(segredoJwt: string): Middleware {
  const porFaixa = new Map<number, Middleware[]>();
  for (const limite of [LIMITE_PADRAO, LIMITE_PUBLICO_FOTO, LIMITE_HARDWARE, LIMITE_UPLOAD]) {
    porFaixa.set(limite, [
      json({ limit: limite, verify: guardarCorpoBruto }),
      urlencoded({ limit: limite, extended: true }),
    ]);
  }
  const xml = text({ limit: LIMITE_HARDWARE, type: ['text/xml', 'application/xml'] });

  return (req, res, next) => {
    const caminho = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    const cadeia = [...(porFaixa.get(faixaDoCorpo(req, segredoJwt)) ?? porFaixa.get(LIMITE_PADRAO)!)];
    if (ROTA_XML.test(caminho)) cadeia.push(xml);
    let i = 0;
    const proximo = (err?: unknown) => {
      if (err || i >= cadeia.length) return next(err);
      cadeia[i++](req, res, proximo);
    };
    proximo();
  };
}
