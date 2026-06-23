/**
 * Gera IMPLANTACAO.pdf a partir do conteúdo do guia de implantação.
 * Usa o mesmo pdfmake do projeto (fonte padrão Helvetica, sem arquivos de fonte).
 *
 * Uso (a partir de click-cond-web/):  node docs/gerar-guia-pdf.mjs
 */
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');
const __dirname = dirname(fileURLToPath(import.meta.url));

const ACCENT = '#2563EB';
const DARK = '#0F172A';
const GRAY = '#475569';

const h1 = (t) => ({ text: t, fontSize: 15, bold: true, color: DARK, margin: [0, 16, 0, 6] });
const h2 = (t) => ({ text: t, fontSize: 12, bold: true, color: ACCENT, margin: [0, 10, 0, 4] });
const p = (t) => ({ text: t, fontSize: 10, color: GRAY, margin: [0, 0, 0, 6], lineHeight: 1.25 });
const steps = (arr) => ({
  ol: arr.map((t) => ({ text: t, margin: [0, 0, 0, 3] })),
  fontSize: 10,
  color: GRAY,
  margin: [0, 0, 0, 6],
});
const bullets = (arr) => ({
  ul: arr.map((t) => ({ text: t, margin: [0, 0, 0, 3] })),
  fontSize: 10,
  color: GRAY,
  margin: [0, 0, 0, 6],
});
const hr = () => ({
  canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#E2E8F0' }],
  margin: [0, 8, 0, 8],
});
function table(headers, rows) {
  return {
    table: {
      headerRows: 1,
      widths: headers.map(() => '*'),
      body: [
        headers.map((h) => ({ text: h, bold: true, color: '#FFFFFF', fillColor: DARK, fontSize: 9, margin: [4, 5] })),
        ...rows.map((r) => r.map((c) => ({ text: c, fontSize: 9, color: '#334155', margin: [4, 4] }))),
      ],
    },
    layout: { hLineColor: () => '#E2E8F0', vLineColor: () => '#E2E8F0' },
    margin: [0, 4, 0, 8],
  };
}

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const docDefinition = {
  defaultStyle: { font: 'Helvetica' },
  pageMargins: [40, 50, 40, 50],
  footer: (current, total) => ({
    text: `Click Portaria — Guia de Implantação   ·   ${current}/${total}`,
    alignment: 'center',
    fontSize: 8,
    color: '#94A3B8',
    margin: [0, 10, 0, 0],
  }),
  content: [
    { text: 'Guia de Implantação', fontSize: 22, bold: true, color: DARK },
    { text: 'Controle de Acesso — Facial, Botoeira, Catraca e Leitores', fontSize: 11, color: ACCENT, margin: [0, 2, 0, 2] },
    { text: 'Passo a passo para instalar na portaria e integrar com os dispositivos.', fontSize: 9, color: '#94A3B8', margin: [0, 0, 0, 6] },
    hr(),

    h1('1. Como o sistema conversa com os aparelhos'),
    p('O sistema web roda na nuvem (o navegador é só a tela). Os aparelhos ficam na rede local, com IP privado (ex.: 192.168.1.50). A comunicação tem dois sentidos:'),
    bullets([
      'Evento sobe (aparelho -> nuvem): o facial/leitor ENVIA o acesso para a URL de webhook pela internet. Alimenta a aba Eventos, registra entrada/baixa e dispara o push no app. NÃO precisa de agente.',
      'Comando desce (nuvem -> aparelho): cadastrar rosto, testar, abrir porta. A nuvem não alcança o IP privado da LAN — quem faz a ponte é o Agente Local (programa num PC da portaria).',
    ]),

    h1('Fase 0 — Antes de sair'),
    bullets([
      'Gere o executável do agente (uma vez): em click-cond-web/agent/ rode "npm run build:exe". Leve click-agent.exe, .env.example e install-windows.bat.',
      'Tenha: login do portal, IPs e credenciais (API) de cada aparelho, e a URL da API na nuvem.',
      'Tenha as fotos dos moradores.',
    ]),

    h1('Fase 1 — Rede física'),
    steps([
      'Ligue os aparelhos no switch e no roteador.',
      'Confirme que o roteador tem internet.',
      'Dê IP fixo a cada aparelho (reserva de DHCP ou IP estático). Sem isso o IP muda e quebra.',
      'Anote IP, porta, usuário e senha da API de cada aparelho.',
      'Escolha o PC da portaria (sempre ligado, mesma rede) — onde o agente roda.',
    ]),

    h1('Fase 2 — Cadastro no sistema web'),
    steps([
      'Acesse o portal e faça login.',
      'Registre o condomínio, blocos e apartamentos.',
      'Cadastre os moradores COM FOTO (a foto é o que o facial reconhece).',
    ]),

    h1('Fase 3 — Cadastrar os dispositivos no portal'),
    p('Em "Terminais de Dispositivos" -> "Novo Dispositivo", para cada aparelho:'),
    steps([
      'Escolha o Tipo: Terminal Facial, Botoeira Relé IP, Catraca Eletrônica IP, Leitor de Tags RFID ou Leitor de QR Code.',
      'Preencha IP, porta, fabricante e usuário/senha da API.',
      'Sentido (facial/catraca/leitor): Entrada, Saída ou Automático. Para baixa por facial, cadastre um terminal de saída com Sentido = Saída.',
      'Salve. O sistema gera o token / URL de webhook do aparelho.',
    ]),

    h1('Fase 4 — Configurar cada aparelho'),
    steps([
      'Faciais e leitores: aponte o "envio de eventos / monitor / push" do aparelho para a URL do webhook (botão "Copiar URL Webhook").',
      'Control iD: habilite a API REST / monitor e use o usuário/senha da API (não só a senha da tela).',
      'Botoeira/catraca: são apenas acionadores. Não têm webhook nem cadastro de rosto — só precisam do IP.',
    ]),

    h1('Fase 5 — Instalar o Agente Local (PC da portaria)'),
    steps([
      'Copie para o PC: click-agent.exe, .env e install-windows.bat.',
      'No .env preencha API_URL (URL da nuvem) e DEVICE_TOKENS (tokens dos aparelhos, separados por vírgula — o token é o final da URL do webhook).',
      'Rode install-windows.bat como Administrador (inicia com o Windows), ou dê dois cliques no .exe para testar.',
      'No portal, o card de cada aparelho deve mostrar "Agente conectado".',
    ]),

    h1('Fase 6 — Enviar os rostos para os faciais'),
    steps([
      'Quando o agente conecta, o sistema já empurra os rostos pendentes sozinho (back-fill automático).',
      'Para forçar/garantir, clique "Sincronizar rostos" na tela de Terminais e acompanhe o painel (enviados / pendentes / erro).',
      'Leitores RFID/QR: cadastre as credenciais com a captura guiada (apresente o crachá no leitor).',
    ]),

    h1('Fase 7 — Testes e go-live'),
    steps([
      '"Testar Conexão" em cada aparelho deve ficar Online.',
      'Botoeira/Catraca: "Acionar Abertura" abre a porta/catraca.',
      'Facial: morador cadastrado chega, é reconhecido, a porta abre e o acesso aparece na aba Eventos + push no app.',
      'Leitor + botoeira: passa o crachá, o sistema identifica e aciona a botoeira automaticamente.',
      'Saída/baixa: teste no terminal de saída (Sentido = Saída) — o visitante recebe baixa.',
    ]),

    h1('Quem faz o quê (por tipo de dispositivo)'),
    table(
      ['Dispositivo', 'Precisa rosto?', 'Precisa webhook?', 'Como abre'],
      [
        ['Facial', 'Sim (sync)', 'Sim (eventos)', 'Reconhece e abre sozinho'],
        ['Botoeira', 'Não', 'Não', 'Acionada pelo sistema/agente'],
        ['Catraca', 'Não', 'Não', 'Acionada pelo sistema/agente'],
        ['Leitor RFID/QR', 'Não (credencial)', 'Sim', 'Lê -> sistema valida -> aciona relé'],
      ],
    ),

    h1('Solução de problemas'),
    table(
      ['Sintoma', 'Causa provável'],
      [
        ['Card "Sem agente"', 'Agente parado / .env errado / PC sem rede'],
        ['"Testar Conexão" Offline', 'IP/porta/credencial errados ou aparelho fora da rede'],
        ['Facial não reconhece', 'Rosto não sincronizado ou morador sem foto'],
        ['Evento não aparece', 'Webhook não configurado no aparelho / sem internet'],
        ['Baixa não acontece', 'Terminal de saída sem Sentido = Saída'],
        ['"Acionar" falha', 'Fabricante sem suporte HTTP (zkteco/topdata/henry) -> botoeira genérica'],
      ],
    ),

    h1('Anexo — Por que o Agente Local (executável)'),
    p('Uma página web servida da nuvem (HTTPS) não consegue falar com um aparelho em IP privado da LAN — nem o servidor na nuvem (não roteia IP privado), nem o navegador (bloqueia HTTP da LAN a partir de página HTTPS). Para a nuvem mandar comando ao aparelho, algo precisa estar dentro da rede fazendo a ponte. O Agente é a menor peça possível e conecta só para fora (não exige liberar porta no roteador).'),
    h2('Dá para não rodar nada?'),
    bullets([
      'Só EVENTOS (sem agente): o aparelho reconhece e abre sozinho e manda eventos para a nuvem (webhook). Aba Eventos, entrada/baixa e push funcionam SEM agente. Perde-se cadastrar rosto pelo portal e acionar remotamente — o cadastro passa a ser feito na tela do aparelho.',
      'Experiência COMPLETA pelo portal (cadastrar do web/app, testar, abrir): exige o Agente. Mas ele é instalado uma vez e roda sozinho com o Windows.',
      'Futuro: aparelhos em modo push (ex.: Control iD) conectam para fora sozinhos; se o backend implementar esse protocolo, o agente deixa de ser necessário (específico por fabricante, ainda não implementado).',
    ]),
  ],
};

pdfmake.setFonts(fonts);
const out = join(__dirname, 'IMPLANTACAO.pdf');
const doc = pdfmake.createPdf(docDefinition);
const buffer = await doc.getBuffer();
writeFileSync(out, buffer);
console.log('Gerado:', out, `(${(buffer.length / 1024).toFixed(0)} KB)`);
