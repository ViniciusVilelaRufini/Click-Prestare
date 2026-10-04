# Landing /sobre — simulador vira pedido de orçamento

Data: 2026-10-04
Arquivo alvo: `click-cond-web/apps/portaria-web/public/sobre/index.html` (página estática, publicada pelo Amplify)

## Problema

Nos 7 dias de campanha (27/09–03/10) foram 173 cliques pagos (Google + ChatGPT) e 5 leads de anúncio: 2,9%. Só 1 desses leads veio com dados completos (~0,6%); o resto entrou no CRM como "Clique no WhatsApp (sem dados)".

Causa principal: a página tem quatro caminhos para o WhatsApp e só um coleta dados.

| Botão | Hoje |
|---|---|
| Topo — "Quero um orçamento" | `wa.me` direto, lead sem dados |
| Simulador (onde o anúncio cai via `?simular=1`) — "Quero essa proposta pelo WhatsApp" | `wa.me` direto, lead só com o resumo das unidades |
| Contato — "Falar no WhatsApp agora" | `wa.me` direto, lead sem dados |
| Formulário `#contato` — "Enviar e abrir o WhatsApp" | lead completo + `wa.me` |

Fatores secundários: a página promete "Resposta em até 1 dia útil" embora a resposta automática do WhatsApp já responda na hora; não há oferta nem âncora de preço no topo; quem chega do anúncio cai no simulador sem contexto do produto.

## Decisões já tomadas

- A página de captação continua sendo a `/sobre` — nada de página nova.
- Velocidade de resposta: a resposta automática do WhatsApp (`whatsapp-automacao.ts`) já cobre o primeiro contato; o usuário acompanha os leads pelo CRM e **não** quer alerta novo.
- Prova social: ainda não existe. Não usar depoimento, logo de cliente nem número de uso.
- Oferta real: **implantação isenta (R$ 490) para os 10 primeiros condomínios que fecharem contrato**. Texto fixo; o usuário remove o selo quando os 10 fecharem.
- Não prometer "sem fidelidade" nem "período de teste".
- Posicionamento: "funciona junto com o seu porteiro"; nunca marketing de substituir o porteiro.

## Desenho

### 1. Simulador com pedido de orçamento embutido

No card de resultado do simulador (`#simulador`), abaixo do preço:

- Linha de implantação: "R$ 490" riscado → "Grátis", com selo "Condição de lançamento: implantação grátis para os 10 primeiros condomínios".
- Título curto "Receba esta proposta no seu WhatsApp" e 3 campos: nome, nome do condomínio, WhatsApp. As unidades **não** são pedidas de novo — vêm do simulador.
- Botão principal "Receber minha proposta".
- Abaixo, link discreto "Prefere falar direto? Abrir o WhatsApp" (o `wa.me` atual do simulador, que continua registrando o clique pelo listener global).
- Os campos só aparecem quando há valor simulado (`simTemValor`); sem unidades fica o "Digite o número de unidades" de hoje.
- Após o envio, os campos dão lugar à confirmação: "Proposta pedida — abrimos o WhatsApp com os seus dados. Se a janela não abrir, chame em (17) 99660-8148."

Envio:

- Validação manual (o `required` não sobrevive ao framework da página): nome, condomínio e WhatsApp obrigatórios; WhatsApp com 10 a 13 dígitos após tirar a máscara — a mesma regra de `validarLead` no backend, para a página nunca aceitar o que a API recusa. Campo inválido recebe `setCustomValidity` + `reportValidity` e foco, como no formulário atual.
- Guarda contra duplo envio, como no formulário atual.
- `psRegistrarLead({ nome, condominio, whatsapp, unidades: <resumo>, site: <honeypot>, pagina: '/sobre/#simulador' })`, onde `<resumo>` é o `simResumo` atual ("80 unidades · Plus · R$ 773,00/mês", ≤ 60 caracteres).
- Abre `wa.me` com a mensagem formatada: título, nome, condomínio, WhatsApp, plano simulado e valor mensal, e a linha "Condição de lançamento: implantação grátis (10 primeiros condomínios)" — registra que a oferta valia no momento do pedido.

Formulário `#contato`: continua (atende o visitante orgânico). Passa a enviar `pagina: '/sobre/#contato'`. Os dois formulários usam **uma função compartilhada** de validação + registro + abertura do WhatsApp; cada um só monta seus dados e a mensagem.

`psRegistrarLead` hoje sobrescreve `pagina` com `location.pathname`; passa a respeitar o `pagina` recebido quando vier preenchido.

### 2. Topo e caminho do anúncio

- `?simular=1` continua rolando até o simulador (não reordenar seções).
- No topo da seção do simulador, linha de contexto para quem chega frio: "Controle de acesso com reconhecimento facial, visitantes e encomendas no app do morador e console para a portaria — funciona junto com o seu porteiro."
- Hero: botão principal deixa de ser `wa.me` e passa a rolar até `#simulador`, com o texto "Ver o preço para o meu condomínio". "Ver os módulos" fica como secundário.
- Hero: abaixo do subtítulo, âncora de preço "A partir de R$ 298/mês · implantação grátis para os 10 primeiros condomínios".
- Celular: barra fixa no rodapé com "Ver meu preço →" (rola até `#simulador`). Aparece depois que o hero sai da tela; some enquanto `#simulador` ou `#contato` estiverem visíveis (IntersectionObserver). Não aparece no computador. Não pode cobrir o banner de cookies: some enquanto o banner estiver aberto.

### 3. Textos

- "Resposta em até 1 dia útil" (lista do `#contato` e rodapé do formulário) → "Resposta na hora pelo WhatsApp".
- "Atendimento comercial humano" → "Atendimento humano em horário comercial".
- Abaixo do botão do simulador, três reforços pequenos: "Sem compromisso", "Proposta com o valor exato do seu condomínio", "Seus dados sob a LGPD, sem spam".
- Subtítulo do `#contato` ganha "Condição de lançamento: implantação grátis para os 10 primeiros condomínios."
- FAQ ganha "Como funciona a implantação grátis?": vale para os 10 primeiros condomínios que fecharem contrato; a implantação de R$ 490 fica isenta e a mensalidade segue a tabela do simulador.
- Os dados estruturados (`ld+json`) e as meta tags não mudam.

### 4. Rastreamento e medição

- Sem mudança no backend nem no banco: `validarLead` já aceita `pagina` (≤ 255) e `unidades` (≤ 60).
- Nenhuma conversão paga é disparada no navegador (regra atual mantida). A confirmação do lead pelo WhatsApp e o envio de conversão ao ChatGPT pelo servidor seguem iguais.
- Fora do escopo: religar o upload de conversões offline para o Google (`registrarGoogleDesabilitado` em `marketing-conversions.service.ts`). Spec próprio.
- Medição semanal pelo CRM, comparando os 7 dias de base com as 3 semanas após religar a campanha:
  - Taxa de lead completo = leads de anúncio com WhatsApp preenchido ÷ cliques pagos. Base ≈ 0,6%. Meta ≥ 5%.
  - Taxa de lead total = leads de anúncio (cliques + formulários) ÷ cliques pagos. Base 2,9%. Meta ≥ 5%.
  - Origem do formulário pelo campo `pagina` (`#simulador` × `#contato`).

## Testes

Jest, no padrão de `apps/portaria-web/src/app/marketing-conversao-openai.spec.ts` (o script é extraído do HTML e executado em jsdom):

- Envio pelo simulador grava o lead com nome, condomínio, WhatsApp como digitado (o backend tira a máscara), `unidades` = resumo e `pagina` = `/sobre/#simulador`, e abre `wa.me` com plano, valor e a linha da oferta.
- WhatsApp com menos de 10 dígitos ou campo obrigatório vazio: não grava e não abre o WhatsApp.
- Formulário `#contato` com a função compartilhada: comportamento atual mantido, agora com `pagina` = `/sobre/#contato`.
- `psRegistrarLead` respeita `pagina` recebido e usa `location.pathname` quando não vier.
- O botão principal do hero não aponta para `wa.me`.
- Nenhum `gtag('event','conversion')` nem `oaiq('measure','lead_created')` no navegador.
- Os testes atuais continuam passando (a extração do handler `enviar` por fatiamento de texto precisa ser ajustada se a função mudar de forma).

Conferência visual com Playwright: desktop e celular (390 px), com e sem `?simular=1` — simulador com e sem unidades, envio, confirmação, barra fixa e selo. Redimensionar a janela só com autorização do usuário; alternativa é conferir no celular depois do deploy.

## Deploy

Arquivo estático da portaria-web: push em `master` e `main`; o Amplify publica. Sem SQL e sem variável de ambiente nova.
