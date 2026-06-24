# 🚀 Guia de Desenvolvimento e Deploy - Click Prestare

Este guia contém as soluções para os problemas de sincronização entre Localhost e Produção (Vercel/Railway) e as instruções para rodar o ambiente local.

## 🛠 Ambiente Local (Localhost)

Para rodar o ecossistema completo localmente, siga os comandos abaixo:

1.  **API Principal (NestJS)**:
    *   Pasta: `click-cond-web`
    *   Comando: `npx nx serve api`
    *   URL: `http://localhost:3000/api`

2.  **Sistema Web Portaria (Angular)**:
    *   Pasta: `click-cond-web`
    *   Comando: `npx nx serve portaria-web`
    *   URL: `http://localhost:4200/`

3.  **App Click (Flutter)**:
    *   Pasta: `click-cond-app/click-cond-app`
    *   Caminho do SDK: `C:\Users\vinic\Desktop\flutter\bin\flutter.bat`
    *   Comando: `C:\Users\vinic\Desktop\flutter\bin\flutter.bat run -d chrome`
    *   *Nota: O caminho do SDK foi salvo em `.antigravity_config.json`.*

4.  **API Legada/Utilitários (Porta 3003)**:
    *   Pasta: `click-cond-api/click-cond-api`
    *   Comando: `npm run dev`
    *   URL: `http://localhost:3003`

---

## 1. Vercel não atualiza com as novidades
**Problema:** Você faz alterações no código, mas o site no Vercel continua mostrando a versão antiga.
**Causa:** O Vercel está configurado para monitorar a branch `main`, mas o desenvolvimento está ocorrendo na branch `master`.
**Solução:**
Sempre que quiser subir as novidades para o Vercel, você deve mesclar a `master` na `main`:
```bash
git checkout main
git pull origin main
git merge master
git push origin main
git checkout master
```

## 2. Estrutura de Monorepo no Vercel
**Problema:** O Vercel não encontra o projeto Angular ou as dependências.
**Solução:** 
- Foi adicionado um `package.json` na **raiz** do repositório para delegar o build para a pasta `click-cond-web`.
- Nas configurações do Vercel (**Settings > General**), o **Root Directory** deve ser `click-cond-web`.
- O comando de build deve ser: `npx nx build portaria-web`.
- A pasta de saída (Output Directory) deve ser: `dist/apps/portaria-web/browser`.

## 3. Imagens não aparecem no App Mobile
**Problema:** O sistema web mostra imagens, mas o App mostra um ícone cinza.
**Causa:** O campo `imagem` no banco de dados está nulo, e apenas a Web tinha um fallback (imagem padrão).
**Solução:**
- O backend (`AreasSociaisService.ts`) agora retorna uma URL padrão do Unsplash se o campo for nulo.
- O App (`cell_area_social.dart`) também possui um link de fallback interno para garantir que nunca fique vazio.

## 4. Sincronização de Banco de Dados
**Importante:** A API em produção (Railway) usa o banco de dados oficial. Se você criar tabelas novas ou mudar o schema, lembre-se de rodar:
```bash
npx prisma generate
npx prisma db push
```
*(Verifique se o DATABASE_URL no Railway está correto antes de rodar comandos de escrita)*.

## 5. Configuração de Domínio Personalizado (Registro.br na Vercel)

Para apontar e associar seu domínio próprio **`clickprestarecondominios.com.br`** ao projeto na Vercel, siga este passo a passo simples:

### Passo 1: Adicionar o Domínio no Painel da Vercel
1. Acesse o **Dashboard da Vercel** e entre na página do seu projeto web (por exemplo, `portaria-web`).
2. Clique na aba **Settings** (Configurações) no menu superior.
3. No menu lateral esquerdo, clique em **Domains** (Domínios).
4. No campo de texto de domínios, digite **`clickprestarecondominios.com.br`** e clique em **Add** (Adicionar).
5. A Vercel exibirá uma janela sugerindo adicionar também a versão com `www` (`www.clickprestarecondominios.com.br`) e criar um redirecionamento automático (ex: redirecionar de `www` para o domínio principal). **Selecione a opção recomendada** (Redirect to clickprestarecondominios.com.br).

### Passo 2: Configurar os Apontamentos de DNS no Registro.br
1. Faça login no painel do [Registro.br](https://registro.br).
2. Clique em cima do domínio **`clickprestarecondominios.com.br`**.
3. Role até a seção **DNS** e clique em **Configurar Zona** (ou *Configurar Endereçamento*, caso esteja usando os servidores DNS padrão do próprio Registro.br).
   > [!NOTE]
   > Se o seu domínio já estiver utilizando servidores de DNS externos (como Cloudflare, HostGator ou Locaweb), as configurações abaixo deverão ser feitas no painel desse respectivo provedor externo, e não no Registro.br.
4. Adicione as seguintes entradas DNS:

#### 1ª Entrada (Para o domínio sem `www`):
* **Nome/Subdomínio**: Deixe vazio (ou digite `@`)
* **Tipo**: `A`
* **Dados/IP**: `216.198.79.1`

#### 2ª Entrada (Para o subdomínio com `www`):
* **Nome/Subdomínio**: `www`
* **Tipo**: `CNAME`
* **Dados/Destino**: `6ad416ae3babd97b.vercel-dns-017.com.`

5. Clique em **Salvar alterações**.

### Passo 3: Confirmação e SSL Grátis
* Assim que salvar no Registro.br, a Vercel detectará os novos apontamentos DNS (geralmente leva de 15 minutos até 2 horas para propagação total).
* O status no painel da Vercel mudará de "Invalid Configuration" para **"Valid Configuration"** (verde).
* A própria Vercel gerará e renovará automaticamente o certificado **SSL gratuito (HTTPS/Cadeado)** para seu domínio.

---

## 6. Como Deployar o CRM Web no Vercel (crm-web)

O CRM é um projeto Angular separado (`crm-web`) dentro do mesmo monorepo. Para colocá-lo no Vercel, você deve criar um **novo projeto** no painel do Vercel apontando para o mesmo repositório do Git, mas configurando os parâmetros específicos do CRM:

### Passo a Passo no Painel do Vercel:
1. Acesse o [Dashboard do Vercel](https://vercel.com/dashboard) e clique em **Add New > Project**.
2. Selecione o repositório do projeto.
3. Configure os seguintes campos (debaixo de **Configure Project**):
   * **Project Name**: `click-crm-web` (ou o nome de sua preferência)
   * **Framework Preset**: Deixe como `Other` ou `Angular` (ele será sobrescrito pelas configurações abaixo).
   * **Root Directory**: Clique em **Edit** e selecione a pasta `click-cond-web`.
4. Abra a aba **Build and Development Settings** e configure:
   * **Build Command**: Ative o botão para customizar (Override) e insira:
     ```bash
     npx nx build crm-web
     ```
   * **Output Directory**: Ative o botão para customizar (Override) e insira:
     ```bash
     dist/apps/crm-web/browser
     ```
5. **Configurações de Rede (Redirecionamento / API)**:
   * Como a pasta `click-cond-web` contém um arquivo `vercel.json` configurado, a Vercel automaticamente importará as regras de redirecionamento. Todas as chamadas para `/api/*` serão redirecionadas para a API de produção no Railway (`https://click-prestare-production.up.railway.app`).
6. Clique em **Deploy**.

---


