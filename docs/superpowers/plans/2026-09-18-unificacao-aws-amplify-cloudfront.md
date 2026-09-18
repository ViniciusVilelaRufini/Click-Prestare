# Unificação Total na AWS: AWS Amplify Hosting + API CloudFront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar 100% da camada web e de borda da Prestare para a AWS (Conta `850401152034`), substituindo a Vercel pelo **AWS Amplify Hosting** (portal Angular) e configurando o subdomínio direto `api.clickprestarecondominios.com.br` via **Amazon CloudFront + ACM**, eliminando qualquer terceiro fora da Amazon e blindando a conformidade com a LGPD.

**Architecture:** O portal web (`portaria-web` Angular) é hospedado no AWS Amplify Hosting com deploy contínuo via GitHub e certificado SSL automático. O tráfego de API e biometria passa a fluir diretamente pelo subdomínio `api.clickprestarecondominios.com.br`, gerenciado pelo Amazon CloudFront com terminação TLS 1.3 e repasse direto para o AWS Elastic Beanstalk em São Paulo (`sa-east-1`). A zona de DNS no Registro.br aponta exclusivamente para a AWS.

**Tech Stack:**
* Frontend: Angular 21, Nx Workspace, AWS Amplify Hosting, `amplify.yml`.
* Edge & DNS: Amazon CloudFront, AWS Certificate Manager (ACM `us-east-1`), Registro.br.
* Backend: Node.js 24 / Express, AWS Elastic Beanstalk (`sa-east-1`), AWS RDS MySQL 8.0 (`database-1`).
* Mobile: Flutter 3.x, Dart (`api_config.dart`).

**Spec:** [`docs/superpowers/specs/2026-09-18-subdominio-api-cloudfront-aws-design.md`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/docs/superpowers/specs/2026-09-18-subdominio-api-cloudfront-aws-design.md)

## Global Constraints
* **AWS Account ID:** `850401152034` (Prestare Gestão).
* **Região ACM para CloudFront:** `us-east-1` (exigência técnica mandatória da AWS para certificados de distribuição global CloudFront).
* **Região de Backend e Banco:** `sa-east-1` (São Paulo, Brasil).
* **Zero Downtime:** Manter o roteamento atual ativo até que o SSL do CloudFront e o build do Amplify estejam 100% validados.
* **Soberania LGPD:** Eliminar 100% da presença e tráfego na Vercel.

---

### Task 1: Solicitação do Certificado SSL no AWS ACM (`us-east-1`)

**Files:**
- Doc: `docs/superpowers/specs/2026-09-18-subdominio-api-cloudfront-aws-design.md`

**Interfaces:**
- Consumes: Domínio `clickprestarecondominios.com.br` registrado no Registro.br.
- Produces: Certificado ACM validado para `api.clickprestarecondominios.com.br`.

- [x] **Step 1: Solicitar certificado público no ACM da região us-east-1**
  No console AWS (região **us-east-1 / N. Virginia**):
  - Ir para **AWS Certificate Manager (ACM)** > **Request certificate**.
  - Certificate type: **Request a public certificate**.
  - Fully qualified domain name: `api.clickprestarecondominios.com.br`.
  - Validation method: **DNS validation**.
  - Key algorithm: **RSA 2048**.
  - Clicar em **Request**.

- [x] **Step 2: Obter os registros CNAME de validação DNS gerados pelo ACM**
  Copiar os valores do registro CNAME gerado no ACM:
  - CNAME Name: `_xxxxxxxx.api.clickprestarecondominios.com.br.`
  - CNAME Value: `_yyyyyyyy.acm-validations.aws.`

- [x] **Step 3: Inserir a entrada CNAME de validação no Registro.br**
  Acessar o painel do **Registro.br** para o domínio `clickprestarecondominios.com.br`:
  - Adicionar novo registro tipo `CNAME`.
  - Nome: `_xxxxxxxx.api`
  - Dados: `_yyyyyyyy.acm-validations.aws.`
  - Salvar alterações.

- [x] **Step 4: Verificar a emissão do certificado**
  Aguardar de 2 a 10 minutos até o status do certificado no ACM mudar de `Pending validation` para **`Issued`** (Emitido).

---

### Task 2: Criação da Distribuição Amazon CloudFront para a API

**Files:**
- AWS Console / CloudFront

**Interfaces:**
- Consumes: Certificado ACM emitido (`api.clickprestarecondominios.com.br`) e URL do Elastic Beanstalk (`Clickprestareapi-env.eba-bcmjawac.sa-east-1.elasticbeanstalk.com`).
- Produces: Distribuição CloudFront (ex.: `d123456abcdef.cloudfront.net`).

- [x] **Step 1: Criar distribuição no Amazon CloudFront**
  No console AWS CloudFront:
  - **Origin Domain:** `Clickprestareapi-env.eba-bcmjawac.sa-east-1.elasticbeanstalk.com`
  - **Protocol:** `HTTP only` (porta 80 do Elastic Beanstalk na origem interna AWS).
  - **Name:** `ClickPrestare-API-Origin`.

- [x] **Step 2: Configurar comportamento padrão de cache (Default Cache Behavior)**
  - **Viewer protocol policy:** `Redirect HTTP to HTTPS`.
  - **Allowed HTTP methods:** `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`.
  - **Cache policy:** `Managed-CachingDisabled` (ID `4135ea2d-6df8-44a3-9df3-4b5a84be39ad`).
  - **Origin request policy:** `Managed-AllViewerExceptHostHeader` (repasse integral de Headers JWT, cookies e query strings, preservando o host do Beanstalk).

- [x] **Step 3: Vincular domínio alternativo e certificado SSL**
  - **Alternate domain name (CNAME):** `api.clickprestarecondominios.com.br`.
  - **Custom SSL certificate:** Selecionar o certificado ACM `api.clickprestarecondominios.com.br` emitido na Task 1.
  - **Security policy:** `TLSv1.2_2021` (recomendado).

- [x] **Step 4: Criar distribuição e aguardar deploy**
  - Clicar em **Create distribution**.
  - Copiar o domínio da distribuição gerado (`d178t4ksw51dte.cloudfront.net`).

---

### Task 3: Criação da Aplicação no AWS Amplify Hosting

**Files:**
- Create/Verify: `amplify.yml` (já criado na raiz do repositório)

**Interfaces:**
- Consumes: Repositório GitHub `ViniciusVilelaRufini/Click-Prestare`, branch `main`.
- Produces: AWS Amplify App provisionado com build automatizado.

- [x] **Step 1: Conectar o repositório no AWS Amplify Console**
  No console AWS (região **sa-east-1** ou **us-east-1**):
  - Acessar **AWS Amplify** > **Deploy an app** (ou *Host web app*).
  - Selecionar **GitHub** como provedor de código.
  - Autorizar a AWS no GitHub e selecionar o repositório `ViniciusVilelaRufini/Click-Prestare`.
  - Selecionar o branch: **`main`**.

- [x] **Step 2: Validar a especificação de build**
  Verificar se o Amplify detecta automaticamente o arquivo [`amplify.yml`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/amplify.yml):
  ```yaml
  version: 1
  frontend:
    phases:
      preBuild:
        commands:
          - nvm install 22 || nvm use 22 || nvm use 20
          - node -v
          - cd click-cond-web
          - npm install
      build:
        commands:
          - npm run build
    artifacts:
      baseDirectory: click-cond-web/dist/apps/portaria-web/browser
      files:
        - '**/*'
    cache:
      paths:
        - click-cond-web/node_modules/**/*
  ```

- [x] **Step 3: Executar o primeiro deploy no Amplify**
  - Clicar em **Save and deploy**.
  - Acompanhar as 4 fases do Amplify: *Provision* ➔ *Build* ➔ *Deploy* ➔ *Verify*.
  - Acessar a URL temporária gerada (`https://main.d340ziyanv9pav.amplifyapp.com`) e validar o carregamento do painel da Portaria.

- [x] **Step 4: Configurar Regras de Redirecionamento e Rewrite (SPA Angular + API Proxy)**
  No painel do app no Amplify > **Rewrites and redirects**:
  - Adicionar regra de proxy para a API e fallback para Single Page Application:
    ```json
    [
      { "source": "/api/<*>", "target": "https://api.clickprestarecondominios.com.br/api/<*>", "status": "200" },
      { "source": "/<*>", "target": "/index.html", "status": "404-200" }
    ]
    ```

---

### Task 4: Associação de Domínio Personalizado no AWS Amplify

**Files:**
- AWS Amplify Console / Custom domains

**Interfaces:**
- Consumes: Domínio `clickprestarecondominios.com.br`.
- Produces: Certificado SSL e entradas CNAME para o Registro.br.

- [x] **Step 1: Adicionar domínio customizado no Amplify**
  No painel do app no Amplify > **Custom domains** > **Add domain**:
  - Digitar: `clickprestarecondominios.com.br`.
  - Configurar subdomínios:
    * `clickprestarecondominios.com.br` ➔ branch `main`.
    * `www.clickprestarecondominios.com.br` ➔ branch `main` (com redirect configurado).
  - Clicar em **Save**.

- [x] **Step 2: Obter os registros de DNS fornecidos pelo Amplify**
  O Amplify exibirá as entradas de DNS necessárias:
  - CNAME para `www` apontando para `d22oqrxevncwi7.cloudfront.net.`
  - Entrada de validação de propriedade SSL.

---

### Task 5: Atualização da Zona de DNS no Registro.br

**Files:**
- Painel de Gestão de DNS do Registro.br

**Interfaces:**
- Consumes: CNAME do CloudFront e CNAME do AWS Amplify.
- Produces: Tráfego de web e API 100% roteado para a AWS.

- [x] **Step 1: Criar/Atualizar o CNAME da API**
  No painel do **Registro.br** (`clickprestarecondominios.com.br`):
  - Tipo: `CNAME`
  - Nome: `api`
  - Valor: `d178t4ksw51dte.cloudfront.net.` (obtido na Task 2)
  - Salvar.

- [x] **Step 2: Atualizar o CNAME do Frontend Web (Substituição da Vercel)**
  - Localizar a entrada existente de `www` (que apontava para a Vercel `cname.vercel-dns.com`).
  - Alterar para:
    * Tipo: `CNAME`
    * Nome: `www`
    * Valor: `d22oqrxevncwi7.cloudfront.net.` (fornecido pelo Amplify)
  - Salvar.

- [x] **Step 3: Validar a propagação de DNS**
  Confirmado via `Resolve-DnsName`:
  - `api.clickprestarecondominios.com.br` ➔ `d178t4ksw51dte.cloudfront.net.`
  - `www.clickprestarecondominios.com.br` ➔ `d22oqrxevncwi7.cloudfront.net.`

---

### Task 6: Atualização de Código nos Clientes Mobile e Web

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/utils/api_config.dart`
- Modify: `click-cond-web/apps/portaria-web/src/app/shared/api.config.ts`

**Interfaces:**
- Consumes: Endpoint `api.clickprestarecondominios.com.br`.
- Produces: Apps e web conectando diretamente à AWS sem intermediação de proxy.

- [x] **Step 1: Atualizar o aplicativo mobile Flutter**
  No arquivo [`click-cond-app/click-cond-app/lib/utils/api_config.dart`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-app/click-cond-app/lib/utils/api_config.dart):
  ```dart
  static String get host {
    if (isProduction) return "api.clickprestarecondominios.com.br";
    if (kIsWeb) return "localhost:3003";
    return "10.0.2.2:3003";
  }
  ```

- [x] **Step 2: Atualizar o portal web para apontar para a API CloudFront**
  Proxy configurado diretamente no AWS Amplify Hosting (`/api/<*>` ➔ `api.clickprestarecondominios.com.br`).

- [x] **Step 3: Testar localmente a compilação do portal web**
  Build concluído com sucesso e validado em produção no AWS Amplify.

- [x] **Step 4: Commit e Push das alterações de código**
  Código sincronizado nas branches `master` e `main` no GitHub.

---

### Task 7: Verificação Ponta a Ponta e Descomissionamento do Vercel

**Files:**
- Painel Vercel

**Interfaces:**
- Consumes: DNS propagado e aplicações em produção.
- Produces: Vercel 100% desativado e excluído.

- [x] **Step 1: Testar o endpoint HTTPS direto da API**
  Validado com sucesso:
  `curl -v https://api.clickprestarecondominios.com.br/api` ➔ `HTTP/1.1 401 Unauthorized` retornado via CloudFront GRU3-P13.

- [x] **Step 2: Testar o acesso web no AWS Amplify**
  Validado com sucesso:
  `curl -v https://www.clickprestarecondominios.com.br/api/condominios/1/apartamentos` ➔ `HTTP/1.1 401 Unauthorized` proxied pelo Amplify Edge para o CloudFront.

- [ ] **Step 3: Descomissionamento definitivo do projeto na Vercel**
  - Acessar o painel [vercel.com](https://vercel.com).
  - Selecionar o projeto `click-cond-web`.
  - Ir em **Settings** > **Advanced** > **Delete Project**.
  - Confirmar a exclusão.
  - Confirmar cancelamento da assinatura/conta na Vercel.
  - Acessar o painel [vercel.com](https://vercel.com).
  - Selecionar o projeto `click-cond-web`.
  - Ir em **Settings** > **Advanced** > **Delete Project**.
  - Confirmar a exclusão.
  - Confirmar cancelamento da assinatura/conta na Vercel.

---

## Verification Plan

### Automated Tests
* Teste de resolução DNS:
  ```powershell
  Resolve-DnsName api.clickprestarecondominios.com.br
  Resolve-DnsName www.clickprestarecondominios.com.br
  ```
* Teste de conectividade e certificado SSL da API:
  ```powershell
  curl.exe -v https://api.clickprestarecondominios.com.br/api/health
  ```
* Teste de compilação do frontend web:
  ```powershell
  cd click-cond-web ; npm run build
  ```

### Manual Verification
1. Acessar `https://www.clickprestarecondominios.com.br` em aba anônima.
2. Efetuar login como porteiro/administrador.
3. Validar atualização de dados em tempo real.
4. Confirmar no painel da Vercel que o projeto foi excluído e não há tráfego.
