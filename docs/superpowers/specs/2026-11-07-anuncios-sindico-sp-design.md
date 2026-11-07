# Anúncios pagos para síndicos em SP (Google Ads + ChatGPT Ads)

**Data:** 2026-11-07
**Status:** aprovado pelo usuário em 07/11/2026

## Intenção

Começar a divulgação paga da linha de controle de acesso da Prestare
(prestarecondominios.com.br) para gerar pedidos de orçamento de condomínios.
O usuário quer testar os dois canais de anúncio — Google Ads e ChatGPT Ads —
ao mesmo tempo, com verba total de **R$ 600/mês**, só no **estado de São
Paulo**, falando **só com síndicos** neste começo.

**Cliente ideal (dito pelo usuário em 07/11):** a Prestare atende o estado
todo, mas o melhor cliente é o condomínio que quer **um sistema para fazer o
próprio controle de acesso**, melhorar a segurança e **ter tudo registrado**
(quem entrou, quando, quem autorizou). Não é quem procura empresa de portaria
terceirizada ou remota para assumir a portaria. A mensagem dos anúncios gira
em torno de: controle feito pelo próprio condomínio + segurança + histórico
registrado e consultável.

Sucesso no primeiro mês = leads reais de síndicos de SP chegando no CRM, com
custo por lead conhecido por canal, para decidir para onde vai a verba no mês 2.

## Metas, não-metas e anti-metas

**Metas**
- Duas campanhas ativas, uma por canal, restritas ao estado de SP.
- Todo pedido de orçamento vindo de anúncio aparece no CRM com a origem certa
  (`google` / `openai`) — isso já funciona via gclid/oppref/utm.
- As plataformas recebem o evento de conversão "lead" para medir e otimizar.
- Revisão semanal e regra clara de realocação no dia 30.

**Não-metas (agora)**
- Anúncio para morador (fica para quando a verba crescer; ideia registrada:
  página "Leve a Prestare para o seu condomínio" com indicação ao síndico).
- Display, YouTube, Performance Max, Meta/Instagram.
- Página nova ou mudança de página: o destino é a `/sobre/` como está.

**Anti-metas (falha mesmo que "funcione")**
- Mensagem do tipo "economize demitindo o porteiro". O posicionamento é
  ferramenta que facilita o trabalho do porteiro, do síndico e dos moradores.
- Prova social inventada (clientes, números, depoimentos) — ainda não existe.
- Prometer período de teste ou "sem fidelidade".
- Gastar fora de SP ou acima de R$ 600 no mês.
- Ligar campanha (gastar dinheiro) sem o usuário confirmar.

## Restrições

- Verba: R$ 600/mês somando os dois canais.
- ChatGPT Ads: no Brasil desde 11/08/2026, em beta. Mínimo diário citado por
  fontes secundárias: R$ 40/dia — **não confirmado**; conferir no Ads Manager.
  Segmentação geográfica existe; precisa confirmar se desce ao nível de estado.
- Google Ads: conta 999-675-8337, já com uma campanha de palavras da marca;
  tag `AW-18476913499` nas páginas. Sem MCC.
- OpenAI: pixel `17H2XPR4dY5HHBNUs9L5ha` nas páginas; CRM já sincroniza gasto
  pela API (`OPENAI_ADS_API_KEY` em `crm_config`).
- Login nas duas plataformas exige o usuário (2FA) na janela do Playwright.
- Preço que pode ir no anúncio: "a partir de R$ 298/mês" (está na `/sobre/`).
  A implantação isenta para os 10 primeiros não aparece na página e fica fora.
- Deploy da landing: push em `master` e `main` (Amplify segue `main`).

## Abordagens consideradas

1. **Um canal por vez** (Google no mês 1, ChatGPT no mês 2) — comparação limpa,
   mas o usuário quer os dois juntos.
2. **Só Google** — mais previsível, mas não testa o ChatGPT. Descartada.
3. **Os dois juntos, com valores diferentes** — **escolhida pelo usuário.**
   Risco: pouco dado em cada canal. Mitigado concentrando a verba em poucas
   palavras de alta intenção e numa única mensagem por canal.

## Desenho

### Divisão da verba (decisão minha)

| Canal | Valor/mês | Como roda |
|---|---|---|
| Google Ads — pesquisa genérica (síndico) | R$ 300 (~R$ 10/dia) | contínuo, orçamento próprio |
| Google Ads — marca (campanha existente) | R$ 60 (~R$ 2/dia) | contínuo, orçamento próprio (nunca compartilhado) |
| ChatGPT Ads | R$ 240 | se o mínimo diário for ≤ R$ 8: contínuo a ~R$ 8/dia; se for R$ 40/dia: 6 dias por mês (ter/qua/qui de semanas alternadas), com data de término definida |

O Google fica com a maior parte porque pega quem já está procurando a solução.

### Google Ads — campanha "Síndico | Pesquisa | SP"

- **Tipo:** Rede de Pesquisa, sem parceiros de pesquisa e sem Display.
- **Local:** Estado de São Paulo, opção "Presença: pessoas que estão ou
  costumam estar" (não "interesse").
- **Idioma:** português. **Horário:** seg–sex 7h–21h, sáb 8h–14h.
- **Lance:** CPC manual, começando em R$ 3,50 por palavra (decisão minha:
  abaixo de 15 conversões/mês o lance inteligente não aprende; com ~R$ 10/dia
  não chegaremos lá no mês 1). Reavaliar quando passar de 15 conversões/mês.
- **Marca:** "prestare" como negativa de frase nesta campanha, para as buscas
  da marca caírem na campanha de marca (orçamento próprio).
- **Gasto diário:** o Google pode gastar até 2× o diário num dia e compensa no
  mês; aumentos de verba em passos de ~20%, com 3–5 dias entre eles.
- **Grupos e palavras** (frase e exata):
  - *Controle de acesso*: "controle de acesso condomínio", "sistema de controle
    de acesso para condomínio", "reconhecimento facial condomínio", "acesso
    facial condomínio".
  - *Registro / portaria digital*: "controle de visitantes condomínio",
    "registro de visitantes condomínio", "livro de portaria digital",
    "sistema de portaria condomínio", "software de portaria",
    "app de portaria". É o grupo mais alinhado ao cliente ideal e recebe
    o lance inicial mais alto (R$ 4,00).
  - *Gestão / app*: "aplicativo para condomínio", "app para síndico",
    "sistema para síndico".
  - A campanha de marca existente continua como está.
- **Fora de propósito:** "portaria remota"/"portaria virtual" ficam fora no
  começo (concorrência cara e público que quer tirar o porteiro).
- **Negativas:** emprego, vaga, vagas, salário, curso, apostila, concurso,
  grátis, gratuito, download, login, entrar, 2ª via, boleto, "como ser
  síndico", casa, residência, academia, empresa, fechadura, catraca usada,
  mercado livre, olx, reclame aqui, nomes de concorrentes com "login".
- **Anúncio responsivo:** 1 por grupo no começo (2 quando houver dado para
  comparar), cada um com **exatamente 15 títulos (≤ 30 caracteres) e 4
  descrições (≤ 90)**, caminhos `/condominio` e `/orcamento` (≤ 15), sem fixar
  posições. Os títulos do grupo repetem as palavras do grupo (relevância →
  Índice de Qualidade). Exemplos de direção:
  - Títulos: "Controle de Acesso p/ Condomínio", "Reconhecimento Facial",
    "App para Síndico e Moradores", "Visitantes e Encomendas no App",
    "A partir de R$ 298/mês", "Simule o Preço Online",
    "Peça seu Orçamento", "Atendemos Todo o Estado de SP",
    "Portaria Mais Ágil e Segura", "Prestare Controle de Acesso",
    "Toda Entrada Fica Registrada", "Histórico de Quem Entrou",
    "Seu Condomínio no Controle".
  - Descrições: "Facial, visitantes, encomendas e ocorrências num só sistema.
    Peça seu orçamento.", "Seu porteiro mais ágil e o síndico com tudo no app.
    Fale no WhatsApp.", "Toda entrada registrada com data, hora e quem
    autorizou. Planos a partir de R$ 298/mês."
  - **Não** prometer implantação grátis: a `/sobre/` cobra R$ 490 no simulador
    e não mostra a oferta dos 10 primeiros. Só entra no anúncio se a oferta
    passar a aparecer na página.
- **Extensões:** sitelinks, todos na `/sobre/`: Simule o preço (`#simulador`),
  Segurança e registro (`#seguranca`), App do condomínio (`#portaria-app`),
  Fale conosco (`#contato`);
  frases de destaque ("App iOS e Android", "Console web", "Suporte em SP"),
  snippet estruturado "Serviços: Facial, Visitantes, Encomendas, Ocorrências".
- **URL final:** `https://www.prestarecondominios.com.br/sobre/` com
  sufixo `utm_source=google&utm_medium=cpc&utm_campaign=sindico-sp`;
  autotag (gclid) ligado.

### ChatGPT Ads — campanha "Síndico | SP"

- **Local:** estado de SP. Se o Ads Manager só permitir país, **parar e
  perguntar ao usuário** antes de criar (ele pediu só SP).
- **Anúncio:** título e texto curtos no mesmo tom do Google (gestão do
  condomínio, facial, toda entrada registrada, a partir de R$ 298/mês);
  URL `/sobre/?utm_source=chatgpt&utm_medium=cpc&utm_campaign=sindico-sp`
  (o `oppref` é acrescentado pela plataforma).
- **Contexto/temas** (se a plataforma pedir): administração de condomínio,
  segurança de condomínio, portaria, síndico.
- **Orçamento e datas:** conforme a tabela acima; com data de término no
  último dia do mês para nunca passar de R$ 240.

### Medição

- **Conversão = lead confirmado no WhatsApp, enviada pelo servidor** (decisão
  já tomada em 30/09, commit 7c221bf4 — não recolocar disparo no navegador; os
  testes `landing-pedido-orcamento.spec.ts` e `marketing-conversao-openai.spec.ts`
  proíbem `gtag('event','conversion')` e `oaiq('measure','lead_created')`).
  - OpenAI: `MarketingConversionsService` já envia `lead_created` offline com
    id = wamid e o `oppref`. Só conferir que funciona com um lead real.
  - Google: o upload offline está desligado. Ligar usando a ação de conversão
    que já existe (rótulo `-xRLCNiSs4gdENumvepE`) — preferência (decisão minha):
    pelo Google Ads Script que já roda na conta (lê do CRM os leads
    confirmados com gclid e sobe como conversão offline), porque a conta não
    tem MCC/token de desenvolvedor para a API. Se o script não permitir, cair
    para upload de planilha semanal.
  - Consentimento: manter o `consentimento-anuncios.js` como está (decisão
    minha). Como a conversão sai do servidor a partir do gclid/oppref
    guardado, a recusa de cookies pesa menos; o viés que sobrar é aceito.
- **CRM:** aba Marketing já mostra gasto, cliques e leads por origem.
  Apagar o lead de teste "TESTE CLAUDE (apagar)" antes do lançamento.
- **Antes de ativar:** fazer um pedido de orçamento real de teste pela URL do
  anúncio e ver a conversão chegar no Google Ads, no pixel da OpenAI e o lead
  no CRM com a origem certa.
- **Rotina semanal (segunda):** placar com 8 números por canal — gasto,
  leads, custo por lead, leads que viraram conversa de verdade no WhatsApp,
  orçamentos enviados, custo por orçamento, parcela de impressões perdida por
  orçamento × por classificação (Google), principais termos desperdiçados.
  Termos de pesquisa em três passes: desperdício (3+ cliques, 0 lead e fora
  do propósito → negativar), vencedores (termo que gerou lead e não é
  palavra-chave → adicionar exata/frase), deriva (correspondência de frase
  puxando sentido errado → apertar). Sem regra fixa de pausa: palavra cara sem
  lead é pergunta, não veredito — conferir amostra antes.
- **Dia 30:** comparar custo por lead (e por orçamento enviado) dos dois
  canais e passar até 70% da verba do mês 2 para o melhor. Com zero leads nos
  dois, revisar anúncio e página antes de gastar mais. O CRM manda sobre os
  números das plataformas.
- **Depois (fora deste plano):** importar para o Google Ads, pelo gclid, os
  leads que viraram contrato (conversão offline).

### Página de destino

Decidido pelo usuário: os anúncios levam para a **`/sobre/`**, não para a
`/sindico/`. A `/sobre/` já mostra "a partir de R$ 298/mês", o simulador de
preço e o registro de cada entrada; **sem mudança na página** neste plano. Os
anúncios só prometem o que ela já mostra.

### Antes de ligar

- Conferir a `/sobre/` no celular com os parâmetros do anúncio: formulário
  gravando lead com a origem certa e abrindo o WhatsApp; âncoras dos
  sitelinks levando à seção certa.
- Campanhas criadas **pausadas**; o usuário revisa e confirma antes de ativar.

## O que fica com quem executar

- Texto final exato dos anúncios dentro dos limites de caracteres.
- Nome do evento de lead do pixel da OpenAI e o rótulo de conversão do Google.
- Ajustes de interface do Ads Manager da OpenAI (beta, pode mudar).
