# Anúncios para síndicos em SP — Plano de execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar no ar, pausadas até o usuário liberar, uma campanha de pesquisa no Google Ads e uma no ChatGPT Ads para síndicos do estado de SP, levando à `/sobre/`, com a conversão "lead confirmado no WhatsApp" chegando às duas plataformas.

**Architecture:** A conversão continua saindo do servidor (decisão de 30/09). OpenAI já recebe `lead_created` offline; o Google passa a receber por um endpoint público com token que o Google Ads Script (já instalado na conta) lê todo dia e sobe como conversão offline. As campanhas são configuradas pela interface das plataformas via Playwright MCP, com login feito pelo usuário na janela.

**Tech Stack:** NestJS + Prisma (apps/api), Jest, Google Ads Scripts (Apps Script), Playwright MCP, Google Ads, OpenAI Ads Manager.

**Spec:** `docs/superpowers/specs/2026-11-07-anuncios-sindico-sp-design.md`

## Global Constraints

- Verba total: **R$ 600/mês** — Google genérico R$ 300 (~R$ 10/dia), Google marca R$ 60 (~R$ 2/dia), ChatGPT R$ 240.
- Local: **estado de São Paulo**, opção "Presença" (nunca "presença ou interesse").
- Público: **só síndico**. Nada de anúncio para morador.
- Destino: `https://www.prestarecondominios.com.br/sobre/` — **sem mudar a página**.
- Pode ir no anúncio: "a partir de R$ 298/mês", simulador de preço, registro de cada entrada (data, hora, quem autorizou), facial, visitantes, encomendas, ocorrências, app, WhatsApp, "Atendemos todo o estado de SP".
- Não pode ir no anúncio: implantação grátis/isenta, período de teste, "sem fidelidade", prova social (clientes, números, depoimentos), "substitua/demita o porteiro", "portaria remota/virtual".
- Conversão no navegador continua proibida (`gtag('event','conversion')`, `oaiq('measure','lead_created')`).
- Toda campanha nasce **pausada**; só o usuário libera gasto.
- Segredos novos vão em `crm_config` cifrados (env do EB no limite de 4096).
- Deploy: push em `master` **e** `main`; conferir o passo "Verify deployed version" do `deploy-api.yml` do `main`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Lead do Google **sem gclid** (autotag desligado, link copiado) → não vai para o upload, mas continua no CRM com origem pela utm. Teste na Task 2.
2. O script roda todo dia e reenvia os mesmos leads → a hora da conversão precisa ser **estável** (sempre `criado_em` do lead) para o Google descartar a duplicata. Teste na Task 2.
3. Lead confirmado de **outra origem** (openai, organico) nunca aparece no upload do Google. Teste na Task 2.
4. Token ausente/errado → 401, sem vazar lista de gclid. Teste na Task 2.
5. Gasto passando do mês: Google pode gastar 2× o diário num dia; ChatGPT precisa de data de término. Conferido nas Tasks 6–7 pelo resumo da campanha antes de salvar.

---

### Task 1: Credenciais de conversão da OpenAI via `crm_config`

Hoje `MarketingConversionsService` lê `OPENAI_ADS_PIXEL_ID` e `OPENAI_ADS_CONVERSIONS_API_KEY` só da env; se não estiverem no EB, a conversão some em silêncio.

**Files:**
- Modify: `click-cond-web/apps/api/src/app/marketing/marketing-segredos.service.ts` (tipo `SegredoMarketing`)
- Modify: `click-cond-web/apps/api/src/app/marketing/marketing-conversions.service.ts`
- Test: `click-cond-web/apps/api/src/app/marketing/marketing-conversions.service.spec.ts`

**Interfaces:**
- Produces: `SegredoMarketing` passa a incluir `'OPENAI_ADS_PIXEL_ID' | 'OPENAI_ADS_CONVERSIONS_API_KEY'`; `new MarketingConversionsService(segredos: Pick<MarketingSegredosService,'obter'>)`.

- [ ] **Step 1: Conferir produção antes de codar.** No CloudShell (`tunel.sh`, ver memória de migrações), `SELECT chave FROM crm_config WHERE chave LIKE 'OPENAI%';` e, no console do EB, se as duas envs existem. Anotar o resultado no commit.
- [ ] **Step 2: Ajustar os testes existentes** para construir o serviço com um falso `segredos` (`{ obter: async (n) => valores[n] }`) em vez de `process.env`, e adicionar:

```ts
it('lê pixel e chave do crm_config quando a env não tem', async () => {
  process.env = { ...originalEnv }; delete process.env.OPENAI_ADS_PIXEL_ID; delete process.env.OPENAI_ADS_CONVERSIONS_API_KEY;
  const service = new MarketingConversionsService({ obter: async (n) => ({ OPENAI_ADS_PIXEL_ID: 'pixel-db', OPENAI_ADS_CONVERSIONS_API_KEY: 'key-db' } as any)[n] });
  fetchSpy.mockResolvedValue({ ok: true });
  await service.confirmarLeadWhatsApp({ wamid: 'w', em: new Date(), lead: { origem: 'openai', oppref: 'op', gclid: null, pagina: '/sobre' } as any });
  expect(fetchSpy).toHaveBeenCalledWith('https://bzr.openai.com/v1/events?pid=pixel-db', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer key-db' }) }));
});
```

- [ ] **Step 3: Rodar e ver falhar.** `cd click-cond-web && npx jest -c apps/api/jest.config.cts apps/api/src/app/marketing/marketing-conversions` → FAIL (construtor sem argumento / pid=pixel-1).
- [ ] **Step 4: Implementar.** Injetar `MarketingSegredosService` no construtor; `enviarOpenAi` usa `await this.segredos.obter(...)` (a env continua com precedência dentro de `obter`). Trocar a mensagem de `registrarGoogleDesabilitado` para `'Conversão Google confirmada; o Google Ads Script envia como conversão offline.'` e remover a checagem das envs `GOOGLE_ADS_*`.
- [ ] **Step 5: Rodar e ver passar** (mesmo comando) + `npx jest -c apps/api/jest.config.cts apps/api/src/app/whatsapp` → PASS.
- [ ] **Step 6: Gravar os segredos se faltarem** (só se o Step 1 mostrou ausência): pedir ao usuário o pixel id (`17H2XPR4dY5HHBNUs9L5ha` está nas páginas) e a chave de conversões do Ads Manager; gravar cifrado em `crm_config` pelo mesmo caminho usado para `OPENAI_ADS_API_KEY` em 28/09.
- [ ] **Step 7: Commit** `feat(marketing): credenciais de conversão da OpenAI pelo crm_config`.

### Task 2: Endpoint de conversões do Google para o Script

**Files:**
- Modify: `click-cond-web/apps/api/src/app/marketing/marketing-ads.service.ts`
- Modify: `click-cond-web/apps/api/src/app/marketing/marketing-public.controller.ts`
- Test: `click-cond-web/apps/api/src/app/marketing/marketing-ads.service.spec.ts`

**Interfaces:**
- Produces:
  - `export interface ConversaoGoogleOffline { gclid: string; conversao_em: string }` — `conversao_em` no formato do Google `yyyy-MM-dd HH:mm:ss-03:00` (BRT fixo; Brasil sem horário de verão).
  - `MarketingAdsService.conversoesGoogle(token: string | undefined, agora?: Date): Promise<ConversaoGoogleOffline[]>` — 401 (`UnauthorizedException`) se `tokenConfere(token, await segredos.obter('ADS_INGEST_TOKEN'))` falhar; devolve leads com `origem = 'google'`, `gclid` não vazio, `criado_em >= agora - 30 dias` e que tenham alguma `Crm_WhatsApp_Conversas.conversao_lead_id` igual ao `id` do lead. `conversao_em` = `criado_em` do lead.
  - `GET /api/public/ads/google/conversoes` com header `X-Ingest-Token`, `@Public()`, `@Throttle({ medium: { limit: 10, ttl: 60_000 } })`.

- [ ] **Step 1: Testes que falham** em `marketing-ads.service.spec.ts` (prisma falso no padrão do arquivo):
  - `rejeita token errado com 401` — `await expect(svc.conversoesGoogle('x')).rejects.toBeInstanceOf(UnauthorizedException)`.
  - `devolve só leads google confirmados com gclid` — 4 leads: google+gclid+confirmado, google sem gclid+confirmado, openai+oppref+confirmado, google+gclid **não** confirmado → resultado `toEqual([{ gclid: 'G1', conversao_em: '2026-11-07 09:30:00-03:00' }])` para `criado_em = 2026-11-07T12:30:00Z`.
  - `hora da conversão é estável entre execuções` — chamar duas vezes com `agora` diferentes (dentro dos 30 dias) → resultados iguais.
  - `ignora leads com mais de 30 dias`.
- [ ] **Step 2: Rodar e ver falhar.** `npx jest -c apps/api/jest.config.cts apps/api/src/app/marketing/marketing-ads.service` → FAIL (`conversoesGoogle is not a function`).
- [ ] **Step 3: Implementar** `conversoesGoogle` e a rota GET no controller. Formatar a data reaproveitando `datas-brt.ts` se ele já tiver formatador BRT; senão, subtrair 3h e formatar com `toISOString().slice(0,19).replace('T',' ') + '-03:00'`.
- [ ] **Step 4: Rodar e ver passar** + suíte do módulo: `npx jest -c apps/api/jest.config.cts apps/api/src/app/marketing` → PASS.
- [ ] **Step 5: Typecheck.** `npx tsc -p apps/api/tsconfig.app.json --noEmit` → sem erros novos.
- [ ] **Step 6: Commit** `feat(marketing): endpoint de conversões offline do Google para o Ads Script`.
- [ ] **Step 7: Deploy.** `git push origin master && git push origin master:main`; acompanhar `gh run watch` do `deploy-api.yml` do `main` até o "Verify deployed version" passar; `curl -s -o /dev/null -w "%{http_code}" https://api.prestarecondominios.com.br/api/public/ads/google/conversoes` → `401`.

### Task 3: Google Ads Script envia as conversões offline

**Files:**
- Modify: `docs/marketing/google-ads-script.js`

**Interfaces:**
- Consumes: `GET /api/public/ads/google/conversoes` (Task 2) → `[{ gclid, conversao_em }]`.
- Produces: constante `NOME_CONVERSAO = 'Lead WhatsApp confirmado'` — o nome exato da ação criada na Task 4.

- [ ] **Step 1: Implementar** `enviarConversoes()` chamada no fim de `main()`: `UrlFetchApp.fetch(URL + '/conversoes', { headers: { 'X-Ingest-Token': TOKEN }, muteHttpExceptions: true })`; se 200 e lista não vazia, `AdsApp.bulkUploads().newCsvUpload(['Google Click ID','Conversion Name','Conversion Time'], { moneyInMicros: false })`, `.forOfflineConversions()`, `.setFileName('crm-prestare-' + data)`, `append` por linha, `.apply()`; logar quantidade enviada. Falha no fetch só loga (não derruba o envio dos números).
- [ ] **Step 2: Commit** `feat(marketing): Ads Script sobe leads confirmados como conversão offline`.
- [ ] A verificação é feita na conta, na Task 4 (o Apps Script não roda localmente).

### Task 4: Google Ads — ação de conversão e Script (Playwright)

Pré-requisito: usuário logado na conta 999-675-8337 na janela do Playwright.

- [ ] **Step 1:** Metas → Conversões → Nova ação → **Importar → Outras fontes / cliques (upload manual)** → nome `Lead WhatsApp confirmado`, categoria "Enviar formulário de lead", valor "não usar valor", contagem **Uma**, janela de clique 30 dias, ação **principal**. (A ação antiga de tag `-xRLCNiSs4gdENumvepE` não aceita upload offline; marcar como **secundária** para não confundir os lances.)
- [ ] **Step 2:** Ferramentas → Ações em massa → Scripts → "CRM Prestare – envio diário" → colar o `google-ads-script.js` novo mantendo o TOKEN já preenchido → **Visualizar**. Esperado no log: `CRM respondeu 201` e `Conversões: N` sem erro (N pode ser 0).
- [ ] **Step 3:** Confirmar agendamento **Diariamente** e autorização ativa. Se o usuário precisar aprovar 2FA, pedir.
- [ ] **Step 4:** Configurações da conta: **autotag ligado**.

### Task 5: Google Ads — campanha de marca com orçamento próprio

- [ ] **Step 1:** Abrir a campanha de marca existente. Conferir: orçamento **não compartilhado**; trocar para **R$ 2,00/dia**.
- [ ] **Step 2:** Local = Estado de São Paulo, **Presença**; Rede de Display e parceiros de pesquisa **desligados**.
- [ ] **Step 3:** Anúncio e URL final apontando para `/sobre/` com `utm_source=google&utm_medium=cpc&utm_campaign=marca-sp`.
- [ ] **Step 4:** Print do resumo de configurações para o relatório final.

### Task 6: Google Ads — campanha "Síndico | Pesquisa | SP" (pausada)

**Files:**
- Create: `docs/marketing/anuncios-sindico-sp.md` — texto final dos anúncios (fonte única para Google e ChatGPT).

- [ ] **Step 1: Escrever o texto** em `docs/marketing/anuncios-sindico-sp.md` no formato do `rsa-output-spec` (estrutura de grupos → negativas → sitelinks → frases de destaque → anúncios): 3 grupos (*Registro / portaria digital*, *Controle de acesso*, *Gestão / app*), cada um com **15 títulos ≤ 30** e **4 descrições ≤ 90**, caminhos `condominio` / `orcamento`; sitelinks Simule o preço `#simulador`, Segurança e registro `#seguranca`, App do condomínio `#portaria-app`, Fale conosco `#contato`; frases de destaque ≤ 25; snippet "Serviços: Facial, Visitantes, Encomendas, Ocorrências". Palavras-chave e negativas exatamente as do spec, mais `prestare` como negativa de frase. Respeitar a lista de proibições das Global Constraints.
- [ ] **Step 2: Conferir limites.** `node -e` lendo o arquivo e contando caracteres de cada linha marcada → nenhum título > 30, descrição > 90, destaque > 25.
- [ ] **Step 3: Commit** `docs(marketing): texto dos anúncios para síndicos em SP`.
- [ ] **Step 4: Criar no Google Ads (Playwright)**: objetivo Leads → Pesquisa; nome `Síndico | Pesquisa | SP`; **sem** parceiros e **sem** Display; SP **Presença**; idioma português; programação seg–sex 07–21h, sáb 08–14h; orçamento **R$ 10,00/dia** próprio; lance **CPC manual** — R$ 4,00 no grupo *Registro / portaria digital*, R$ 3,50 nos outros; meta de conversão = `Lead WhatsApp confirmado`; grupos, palavras (frase + exata), negativas, anúncios e extensões do arquivo; URL final `/sobre/` com sufixo `utm_source=google&utm_medium=cpc&utm_campaign=sindico-sp`.
- [ ] **Step 5:** Salvar **pausada**. Conferir no resumo: local, rede, orçamento, lance. Print para o relatório.

### Task 7: ChatGPT Ads — campanha "Síndico | SP" (pausada)

Pré-requisito: usuário logado no OpenAI Ads Manager na janela do Playwright.

- [ ] **Step 1: Verificar a plataforma** e anotar no `anuncios-sindico-sp.md`: (a) segmentação por **estado** existe? (b) orçamento diário mínimo em BRL; (c) campos e limites do anúncio.
- [ ] **Step 2: Se só houver país, PARAR** e perguntar ao usuário (ele pediu só SP).
- [ ] **Step 3: Orçamento.** Mínimo ≤ R$ 8/dia → R$ 8/dia contínuo com término no último dia do mês. Mínimo maior → orçamento total (vitalício) de **R$ 240** se existir; senão diário no mínimo com programação ter/qua/qui em semanas alternadas e término que feche ≤ R$ 240.
- [ ] **Step 4: Criar** com o texto da seção ChatGPT do `anuncios-sindico-sp.md`, URL `/sobre/?utm_source=chatgpt&utm_medium=cpc&utm_campaign=sindico-sp`, temas administração de condomínio / segurança de condomínio / portaria / síndico. Salvar **pausada** (ou rascunho). Print.
- [ ] **Step 5: Commit** das anotações da plataforma no `anuncios-sindico-sp.md`.

### Task 8: Teste ponta a ponta e liberação

- [ ] **Step 1: Limpar teste antigo.** Apagar o lead "TESTE CLAUDE (apagar)" (id 1) do `crm_leads` pelo CloudShell (`tunel.sh`), conferindo antes com SELECT.
- [ ] **Step 2: Lead de teste pela URL do anúncio** (Playwright, celular 390px): abrir `/sobre/?gclid=TESTE-CLAUDE-1107&utm_source=google&utm_medium=cpc&utm_campaign=sindico-sp`, aceitar cookies, preencher o formulário com nome "TESTE CLAUDE 07/11 (apagar)". Esperado: lead no CRM com origem `google` e gclid gravado; WhatsApp abre. Conferir os 4 sitelinks levando à seção certa.
- [ ] **Step 3: Conversão.** Mandar uma mensagem do WhatsApp do usuário para o comercial a partir dessa conversa (pedir ao usuário) → `curl -H "X-Ingest-Token: ..."` no endpoint da Task 2 lista o gclid de teste. (O upload no Google vai rejeitar o gclid falso — esperado.) Apagar o lead de teste depois.
- [ ] **Step 4: Revisão do usuário.** Mandar resumo com prints das Tasks 5–7 e o arquivo de texto. **Só ativar com "pode ligar" explícito.**
- [ ] **Step 5: Ativar** as duas campanhas; registrar data de início. Atualizar a memória `crm-marketing-aba` e a nota do vault (skill brain-click) com contas, nomes de campanha e datas.

## Operação depois de ligar (rotina, não é tarefa de código)

- **Dias 1–3:** conferir se as campanhas entregam (impressões > 0), reprovações de anúncio e termos de pesquisa reais.
- **Toda segunda:** placar de 8 números por canal (gasto, leads, custo por lead, leads que viraram conversa no WhatsApp, orçamentos enviados, custo por orçamento, impressão perdida por orçamento × classificação, termos desperdiçados); três passes nos termos de pesquisa (desperdício → negativar; vencedores → adicionar; deriva → apertar). Mudança de verba em passos de ~20%, 3–5 dias entre eles.
- **Dia 30:** comparar custo por lead e por orçamento dos dois canais (o CRM manda); até 70% da verba do mês 2 para o melhor; zero leads nos dois → revisar anúncio e página antes de gastar mais.
