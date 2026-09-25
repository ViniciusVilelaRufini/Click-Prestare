const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const imagePath = path.resolve('C:/Users/vinic/.gemini/antigravity-ide/brain/f45056ea-4ee1-473a-84bc-e8eee7bb8827/aws_architecture_sketch_1790304638959.jpg');
const imageBase64 = fs.existsSync(imagePath) 
  ? `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString('base64')}`
  : '';

// SVGs for clean, universal vector rendering without emoji font fallback bugs
const svgCloud = `<svg style="vertical-align: middle; margin-right: 4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
const svgLayers = `<svg style="vertical-align: middle; margin-right: 6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e40af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
const svgChart = `<svg style="vertical-align: middle; margin-right: 6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
const svgRocket = `<svg style="vertical-align: middle; margin-right: 6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>`;

const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Click Prestare — Arquitetura de Nuvem e Capacidade AWS</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 12mm 10mm 12mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, Helvetica, sans-serif;
      color: #0f172a;
      background-color: #ffffff;
      line-height: 1.45;
      font-size: 10.5pt;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      page-break-after: always;
      break-after: page;
      display: flex;
      flex-direction: column;
      height: 279mm;
      max-height: 279mm;
      position: relative;
    }

    .page:last-child {
      page-break-after: avoid;
      break-after: avoid;
    }

    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 2px solid #cbd5e1;
      margin-bottom: 10px;
    }

    .brand-logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo-box {
      width: 36px;
      height: 36px;
      background-color: #1e3a8a;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-weight: 800;
      font-size: 17px;
    }

    .brand-title {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: -0.3px;
      color: #0f172a;
      line-height: 1.1;
    }

    .brand-title span {
      color: #2563eb;
    }

    .brand-subtitle {
      font-size: 9px;
      color: #64748b;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .meta-badge {
      text-align: right;
    }

    .badge-aws {
      display: inline-flex;
      align-items: center;
      background-color: #f1f5f9;
      color: #1e293b;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 9pt;
      font-weight: 700;
      border: 1px solid #cbd5e1;
    }

    .date-text {
      font-size: 8pt;
      color: #64748b;
      margin-top: 2px;
      font-weight: 500;
    }

    h1 {
      font-size: 18pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-bottom: 3px;
      line-height: 1.2;
    }

    .lead-text {
      font-size: 9.8pt;
      color: #334155;
      margin-bottom: 10px;
      line-height: 1.4;
    }

    .diagram-container {
      width: 100%;
      border-radius: 10px;
      overflow: hidden;
      border: 1.5px solid #94a3b8;
      margin-bottom: 12px;
      background-color: #0b1120;
    }

    .diagram-img {
      width: 100%;
      max-height: 330px;
      object-fit: contain;
      display: block;
    }

    .diagram-caption {
      background-color: #0f172a;
      color: #94a3b8;
      font-size: 8.5pt;
      padding: 5px 12px;
      text-align: center;
      font-weight: 600;
      border-top: 1px solid #1e293b;
    }

    .section-title {
      font-size: 12pt;
      font-weight: 800;
      color: #0f172a;
      display: flex;
      align-items: center;
      margin-top: 12px;
      margin-bottom: 8px;
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 3px;
    }

    .row-cards {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }

    .row-cards > * {
      flex: 1;
    }

    .card {
      background-color: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 10px 12px;
      page-break-inside: avoid;
    }

    .card-c1 { border-left: 4px solid #2563eb; }
    .card-c2 { border-left: 4px solid #7c3aed; }
    .card-c3 { border-left: 4px solid #16a34a; }
    .card-c4 { border-left: 4px solid #d97706; }

    .card-title {
      font-size: 10pt;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .card-body {
      font-size: 9pt;
      color: #334155;
      line-height: 1.4;
    }

    .kpi-card {
      background-color: #ffffff;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 10px;
      text-align: center;
      page-break-inside: avoid;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .kpi-value {
      font-size: 17pt;
      font-weight: 800;
      color: #1e40af;
      letter-spacing: -0.5px;
      line-height: 1.1;
    }

    .kpi-label {
      font-size: 8pt;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 3px;
    }

    .kpi-desc {
      font-size: 7.5pt;
      color: #64748b;
      margin-top: 2px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      margin-bottom: 12px;
      font-size: 9pt;
      page-break-inside: avoid;
      border: 1.5px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
    }

    th {
      background-color: #0f172a;
      color: #ffffff;
      font-weight: 700;
      text-align: left;
      padding: 7px 10px;
      font-size: 8.5pt;
      letter-spacing: 0.3px;
      border-right: 1px solid #334155;
    }

    th:last-child {
      border-right: none;
    }

    td {
      padding: 7px 10px;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1px solid #f1f5f9;
      color: #1e293b;
    }

    td:last-child {
      border-right: none;
    }

    tr:nth-child(even) td {
      background-color: #f8fafc;
    }

    .highlight-cell {
      font-weight: 700;
      color: #1e40af;
    }

    .tag {
      display: inline-block;
      font-size: 7pt;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .tag-blue { background-color: #dbeafe; color: #1e40af; }
    .tag-green { background-color: #dcfce7; color: #166534; }
    .tag-purple { background-color: #f3e8ff; color: #6b21a8; }
    .tag-amber { background-color: #fef3c7; color: #92400e; }

    .bullet-list {
      list-style: none;
      padding-left: 0;
    }

    .bullet-list li {
      position: relative;
      padding-left: 14px;
      margin-bottom: 4px;
      font-size: 8.8pt;
      color: #334155;
      line-height: 1.35;
    }

    .bullet-list li::before {
      content: "•";
      position: absolute;
      left: 2px;
      color: #2563eb;
      font-weight: bold;
      font-size: 11pt;
      line-height: 1;
    }

    .footer {
      margin-top: auto;
      padding-top: 6px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #64748b;
      font-weight: 500;
    }

    .code-pill {
      font-family: 'Consolas', 'Courier New', monospace;
      background-color: #e2e8f0;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 8.5pt;
      color: #0f172a;
    }
  </style>
</head>
<body>

  <!-- PÁGINA 1 -->
  <div class="page">
    <div class="header-bar">
      <div class="brand-logo">
        <div class="logo-box">P</div>
        <div>
          <div class="brand-title">PRESTARE <span>GESTÃO</span></div>
          <div class="brand-subtitle">Relatório Técnico de Arquitetura & Infraestrutura</div>
        </div>
      </div>
      <div class="meta-badge">
        <div class="badge-aws">${svgCloud} AWS Cloud Production</div>
        <div class="date-text">Setembro / 2026 &bull; Página 1 de 2</div>
      </div>
    </div>

    <h1>Arquitetura de Nuvem & Capacidade Operacional</h1>
    <p class="lead-text">
      Visão técnica integrada da plataforma Click Prestare: dimensionamento, fluxo de conexões de clientes, proteções de borda e alta disponibilidade na infraestrutura Amazon Web Services.
    </p>

    <!-- ESBOÇO VISUAL DA ARQUITETURA -->
    <div class="diagram-container">
      ${imageBase64 ? `<img src="${imageBase64}" class="diagram-img" alt="Diagrama Arquitetural AWS Click Prestare" />` : '<div style="color:white;padding:40px;text-align:center;">Diagrama Arquitetural AWS</div>'}
      <div class="diagram-caption">Esboço Arquitetural Oficial da Plataforma Click Prestare na AWS (Região sa-east-1)</div>
    </div>

    <!-- KPI CARDS DA CAPACIDADE -->
    <div class="row-cards">
      <div class="kpi-card">
        <div class="kpi-value">25 a 40</div>
        <div class="kpi-label">Condomínios Médios</div>
        <div class="kpi-desc">80 a 120 apartamentos cada</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">6.000 a 10.000</div>
        <div class="kpi-label">Pessoas Cadastradas</div>
        <div class="kpi-desc">Moradores, síndicos e funcionários</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">150 a 250</div>
        <div class="kpi-label">Req/s Simultâneas</div>
        <div class="kpi-desc">Throughput contínuo no pico de carga</div>
      </div>
    </div>

    <div class="section-title">
      ${svgLayers} Detalhamento das Camadas (Parte 1: Borda e Clientes)
    </div>

    <div class="row-cards">
      <div class="card card-c1">
        <div class="card-title">
          <span class="tag tag-blue">Camada 1</span> Clientes & Dispositivos
        </div>
        <div class="card-body">
          <ul class="bullet-list">
            <li><b>App Mobile (Flutter):</b> Operado por moradores e síndicos (Android & iOS). Comunicação HTTPS com tokens JWT criptografados.</li>
            <li><b>Portaria Web (Angular SPA):</b> Painel operacional das guaritas conectando-se diretamente à API para preservar IP do porteiro.</li>
            <li><b>Terminais de Controle de Acesso:</b> Catracas faciais (Hikvision/Intelbras) reportando eventos de passagem em tempo real.</li>
          </ul>
        </div>
      </div>

      <div class="card card-c2">
        <div class="card-title">
          <span class="tag tag-purple">Camada 2</span> Borda Global & Segurança (Edge)
        </div>
        <div class="card-body">
          <ul class="bullet-list">
            <li><b>Amazon CloudFront:</b> CDN de borda com terminação SSL/TLS ultrarrápida e proteção nativa contra ataques DDoS (AWS Shield).</li>
            <li><b>AWS Amplify:</b> Hospedagem estática serverless dos bundles da Portaria Web, sem onerar a CPU do servidor backend.</li>
            <li><b>Compressão & HTTP/2-HTTP/3:</b> Respostas otimizadas e latência reduzida para conexões 4G/5G móveis.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="footer">
      <div>Prestare Gestão e Tecnologia &bull; Engenharia de Software e Infraestrutura</div>
      <div>Confidencial &bull; Ambiente AWS sa-east-1</div>
    </div>
  </div>

  <!-- PÁGINA 2 -->
  <div class="page">
    <div class="header-bar">
      <div class="brand-logo">
        <div class="logo-box">P</div>
        <div>
          <div class="brand-title">PRESTARE <span>GESTÃO</span></div>
          <div class="brand-subtitle">Relatório Técnico de Arquitetura & Infraestrutura</div>
        </div>
      </div>
      <div class="meta-badge">
        <div class="badge-aws">${svgCloud} AWS Cloud Production</div>
        <div class="date-text">Setembro / 2026 &bull; Página 2 de 2</div>
      </div>
    </div>

    <div class="section-title" style="margin-top: 4px;">
      ${svgLayers} Detalhamento das Camadas (Parte 2: Servidor e Dados)
    </div>

    <div class="row-cards">
      <div class="card card-c3">
        <div class="card-title">
          <span class="tag tag-green">Camada 3</span> Aplicação (Elastic Beanstalk)
        </div>
        <div class="card-body">
          <ul class="bullet-list">
            <li><b>NestJS Node.js:</b> Motor assíncrono não-bloqueante de altíssima eficiência em I/O.</li>
            <li><b>Trust Proxy = 2:</b> Rastreamento exato do IP real de cada cliente (CloudFront &rarr; ALB &rarr; API), bloqueando forjamento de cabeçalho.</li>
            <li><b>Rate Limiting (Throttler):</b> Trava de segurança configurada em 20 req/s por IP e limitação contra ataques de força bruta no login.</li>
            <li><b>WebSockets em Tempo Real:</b> Notificação imediata de visitantes e encomendas para os moradores.</li>
          </ul>
        </div>
      </div>

      <div class="card card-c4">
        <div class="card-title">
          <span class="tag tag-amber">Camada 4</span> Banco de Dados & Armazenamento
        </div>
        <div class="card-body">
          <ul class="bullet-list">
            <li><b>Amazon RDS MySQL:</b> Banco relacional gerenciado com pool de conexões Prisma, backup diário e queries indexadas de 2 a 10ms.</li>
            <li><b>Amazon S3 Bucket:</b> Armazenamento dedicado para fotos faciais, documentos, boletos e logs de segurança.</li>
            <li><b>Desacoplamento de Mídia:</b> Arquivos pesados não trafegam na memória da API, preservando a estabilidade da máquina.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="section-title">
      ${svgChart} Matriz de Dimensionamento de Condomínios Suportados
    </div>

    <table>
      <thead>
        <tr>
          <th>Porte do Condomínio</th>
          <th>Perfil Típico</th>
          <th>Condomínios Suportados</th>
          <th>Total de Pessoas</th>
          <th>Concorrência no Pico</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><b>Pequeno Porte</b></td>
          <td>20 a 50 unidades (apto/casas)</td>
          <td class="highlight-cell">60 a 100 condomínios</td>
          <td>~4.000 a 7.500 moradores</td>
          <td>~100 a 180 req/s</td>
        </tr>
        <tr>
          <td><b>Médio Porte (Padrão)</b></td>
          <td>80 a 120 unidades</td>
          <td class="highlight-cell">25 a 40 condomínios</td>
          <td>~6.000 a 10.000 moradores</td>
          <td>~150 a 250 req/s</td>
        </tr>
        <tr>
          <td><b>Grande Porte / Clubes</b></td>
          <td>200 a 400 unidades</td>
          <td class="highlight-cell">10 a 15 condomínios</td>
          <td>~7.500 a 11.000 moradores</td>
          <td>~180 a 260 req/s</td>
        </tr>
        <tr>
          <td><b>Condomínios Comerciais</b></td>
          <td>Salas comerciais / Escritórios</td>
          <td class="highlight-cell">20 a 30 edifícios</td>
          <td>~8.000 pessoas cadastradas</td>
          <td>~200 a 250 req/s</td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">
      ${svgRocket} Escalabilidade Horizontal Futura (50.000+ Pessoas)
    </div>

    <div class="card" style="background-color: #ffffff; border: 1.5px solid #cbd5e1; border-left: 4px solid #2563eb; margin-bottom: 12px;">
      <div class="card-body" style="font-size: 9pt; color: #1e293b;">
        A plataforma foi construída seguindo o princípio <i>Stateless</i> (sem sessão presa em memória local). Quando a Prestare ultrapassar a marca de 40 condomínios, a expansão para atender <b>50.000 a 100.000 pessoas</b> é realizada diretamente no console da AWS sem alterar o código:
        <ul class="bullet-list" style="margin-top: 6px;">
          <li><b>Elastic Beanstalk Auto-Scaling:</b> Ativar cluster de 2 a 4 instâncias com balanceador de carga automático (Elastic Load Balancer).</li>
          <li><b>Amazon RDS Multi-AZ:</b> Ajustar a instância do banco para a classe <span class="code-pill">db.t3.small</span> ou <span class="code-pill">db.t3.medium</span> com réplicas de leitura automáticas.</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <div>Prestare Gestão e Tecnologia &bull; Engenharia de Software e Infraestrutura</div>
      <div>Confidencial &bull; Ambiente AWS sa-east-1</div>
    </div>
  </div>

</body>
</html>`;

const tempHtmlPath = path.resolve(__dirname, 'temp_architecture_report.html');
const outputPdfPath = path.resolve('C:/Users/vinic/Desktop/Click-with-Prestare/Arquitetura_AWS_Click_Prestare.pdf');
const brainPdfPath = path.resolve('C:/Users/vinic/.gemini/antigravity-ide/brain/f45056ea-4ee1-473a-84bc-e8eee7bb8827/Arquitetura_AWS_Click_Prestare.pdf');

fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');

const chromePath = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const edgePath = 'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe';
const browserExe = fs.existsSync(chromePath) ? chromePath : edgePath;

console.log('Gerando PDF com browser:', browserExe);

const cmd = `"${browserExe}" --headless --disable-gpu --run-all-compositor-stages-before-draw --no-pdf-header-footer --print-to-pdf="${outputPdfPath}" "${tempHtmlPath}"`;
execSync(cmd);

// Copia também para o diretório de artefatos
if (fs.existsSync(outputPdfPath)) {
  fs.copyFileSync(outputPdfPath, brainPdfPath);
  console.log('PDF gerado com sucesso!');
  console.log('Destino 1:', outputPdfPath);
  console.log('Destino 2:', brainPdfPath);
}
