# Varredura web + app — 28/09/2026

Ambiente: produção, condomínio de teste **Boa Vista** (id 1).
- Web (portaria-web) logado como síndico `suporte@clickprestarecondominios.com.br`.
- App (emulador Pixel_10, Android 17) logado como morador **Vinicius Família** (`viniciusrufini17@gmail.com`), Bloco A / Apto 106.

## Status das correções (reteste 28/09, após deploy de `48b8353d` + APK novo)

Plano: `docs/superpowers/plans/2026-09-28-correcoes-varredura.md`.

| # | Situação |
|---|----------|
| 1 | ✅ Corrigido e retestado — app mostra "Você é membro da família" e some o botão "+" para quem não é proprietário |
| 2 | ✅ Dado corrigido (id 45 → proprietario). Depois disso o síndico editou o morador pelo console às 20:07 e o vínculo virou `dependente` (id 53) — edição manual, não bug |
| 3 | ✅ Corrigido (teste automatizado); não retestado na tela |
| 4 | ⚪ Não reproduzido — pull-to-refresh levou o card de 3 para 4 encomendas |
| 5 | ✅ Corrigido (e-mail desabilitado/limpo para menor); não retestado na tela |
| 6 | ✅ Data de nascimento sem futuro; CPF sem máscara e "voltar sem confirmar" ficaram de fora |
| 7 | ✅ Corrigido e retestado — ocorrência nova aparece ao voltar para a lista |
| 8 | ✅ Corrigido e retestado — push "Ocorrência atualizada" chegou na hora; push de comunicado não retestado |
| 9 | ✅ Polling 30 s e pausado com a aba oculta |
| 10 | ✅ Corrigido; não retestado na tela |
| 11 | ✅ Corrigido (teste automatizado) |
| 12 | ✅ Corrigido e retestado — "X2" recusada com "Placa inválida…" |
| 13 | ✅ Corrigido e retestado — busca "Vinicius Fam" traz só o morador certo |
| 14 | ✅ Corrigido e retestado — enquete não é criada (ver item 20) |
| 15 | ⚪ Não era bug (contador ainda carregando) |
| 16 | ✅ "Agora" do seletor usa o relógio de Brasília; não retestado na tela |
| 17 | ✅ Corrigido (teste automatizado) |
| 18 | ✅ "Bloco Bloco" corrigido e retestado; "R$" e acento do Delivery corrigidos |
| 19 | ✅ Corrigido e retestado — "1 no local" |

## Achados do reteste

### 20. 🟡 Modal de enquete não mostra o erro do backend
- Com término antes do início o backend recusa (400) e a enquete não é criada, mas o modal só fica aberto, sem mensagem — o erro aparece apenas no console.

### 21. 🟠 Instalação nova não pede permissão de notificação (Android 13+)
- Após instalar do zero e logar, `POST_NOTIFICATIONS` ficou `granted=false`; nenhum push aparece até conceder manualmente.
- O app pede a câmera ao abrir e o Firebase pede notificação em `firebase_service.dart:41` no mesmo momento. Hipótese: dois pedidos simultâneos e o Android descarta o segundo. A confirmar antes de corrigir.

### 22. 🔴 Funcionários do condomínio não apareciam para o morador — ✅ corrigido
- App "Funcionários do Condomínio" vazio; web mostrava o porteiro João Junior.
- Causa: a unidade de destino ficou obrigatória para prestador/funcionário (`b26c4079`) e o filtro de privacidade do morador (`escopoDeLeitura`) só libera prestadores sem unidade ou da unidade dele. O porteiro foi cadastrado em "Bloco Condominio / 01" e sumia para todos.
- Correção (`2c6dbe0f`): unidade opcional no console e no app (síndico/funcionário); sem unidade = "Condomínio (todos os moradores)"; backend grava 0/vazio como null. Dado do João ajustado (id_apartamento → NULL). Retestado: aparece no app do morador.
- O CI de `master` também faz deploy no EB e colide com o `deploy-api.yml` de `main` (o de `main` passou). A mesma espera por "Ready" precisa ir para o passo de deploy do CI.

## Varredura em ciclos (28/09, noite)

### Ciclo 1 — console web + consistência de dados
- Todas as 17 rotas do console carregam sem erro de console nem 4xx/5xx.
- **23. 🔴 Editar morador apagava vínculos em outros condomínios — ✅ corrigido (`bb9e970a`)**. `moradores.update` fazia `apartamentos_Users.deleteMany/updateMany({ where: { id_user } })`: trocar o apto (ou o tipo) de alguém aqui apagava/alterava o vínculo dele em todos os prédios. Agora filtra pelo condomínio do morador. Teste: `moradores-vinculo-escopo.spec.ts`.
- **24. 🟠 Excluir apartamento deixava moradores com bloco/apto antigos — ✅ corrigido (`bb9e970a`)**. A cascata levava o vínculo, mas `Moradores.bloco/apartamento` ficava; encomendas casam destinatário por esse texto, então um "101" recriado herdaria o ex-morador. Agora o `remove` limpa esses campos. Dados: 6 moradores órfãos (ids 1–5, 31) limpos.
- **25. 🟡 Telefone faltando em 38 moradores** (legado do bug 3) — dados preenchidos a partir de `Users.phone`.
- **26. 🟡 CI e deploy-api publicavam o mesmo ambiente EB em paralelo** — ✅ job da API no `master` entra no mesmo grupo de concorrência (fila). Confirmado: os dois passaram no push seguinte.
- Pendências de dados (teste): vínculo sem cadastro de morador (user 12, Bloco B/101, carga inicial); morador 39 com texto D/110 e vínculo em "Bloco Condominio/01"; tabela `Encomendas` com collation `utf8mb4_unicode_ci` e as demais `utf8mb4_0900_ai_ci` (join direto por texto falha).

### Ciclo 2 — app (Delivery)
- Fluxo morador → portaria funciona: aviso criado no app aparece na fila do web; push "Seu entregador chegou à portaria." chega na hora (o primeiro teste perdeu o push por coincidir com um deploy da API).
- **27. 🟠 Delivery ilegível no tema escuro do console — ✅ corrigido (`91c1b97e`)**: cartões `bg-white` com texto branco; passou aos tokens `bg-graphite-200`/`border-white/10`; ganhou a margem das outras telas.
- **28. 🟠 "Recusada" e "Retirada na portaria" não avisavam o morador — ✅ corrigido (`91c1b97e`)**, com o motivo da recusa no push.
- **29. 🟡 "Bloco Bloco A" no aviso de delivery (app) e em textos do backend** (auditoria, convites, encomendas, avisos do financeiro) — ✅ corrigido. Nomes de fatura do financeiro mantidos (são chave de busca `startsWith/contains`).
- **30. 🟠 (produto) "Aguardando autorização" sem ação para o morador**: status e push dizem "a portaria aguarda sua autorização", mas o app só permite cancelar; autorizar é exclusivo da portaria. Decidir: botão "Autorizar" no app ou trocar o texto.
- **31. 🟡 UX**: painel do atendimento no console fecha ao mudar o status; lista de delivery do app não atualiza ao voltar do segundo plano (só com pull-to-refresh); detalhe usa o objeto da lista sem buscar de novo.

### Ciclo 3 — app (Mudança) + verificação
- Verificado em produção: Delivery legível nos temas escuro e claro; push "Sua entrega foi recusada pela portaria. Motivo: …" chega na hora.
- **32. 🟠 Mudança agendada sem horário — ✅ corrigido no app**: `new_mudanca.dart` não validava a hora (o backend aceita nula) e a data vazia caía em "Data informada inválida!". Agora exige data e hora com mensagens claras. O seletor já bloqueia datas passadas.
- **33. 🟠 (produto) Console web sem tela de Mudanças**: o morador agenda e a mudança fica "Pendente", mas a portaria no console não vê nem aprova (só em Relatórios / app do síndico).
- APK com as correções de app dos ciclos 1–3 instalado no emulador.

## Bugs

### 1. 🔴 App mostra "Você é o proprietário" para qualquer morador
- `Singleton.isProprietarioApto()` retorna `true` quando `apto_tipo` está vazio (`click-cond-app/lib/pages/singleton.dart:27`).
- `apto_tipo` só é preenchido no fluxo do síndico (`lib/pages/sindico/list_condominiums.dart:175`) e no auto-vínculo (`lib/pages/shared/my_condominium.dart:330`).
- Efeito: inquilino/membro vê o selo de proprietário e o botão "+ familiar" em Meu Apartamento; ao salvar, o backend (`insertFamiliar`, `mobile-auth.service.ts:3856`) recusa com "Apenas o proprietário do apartamento pode cadastrar familiares."
- Reproduzido no emulador.

### 2. 🟠 Vínculo divergente entre `Apartamentos_Users` e `Moradores`
- Vinicius Família (user 41): `Apartamentos_Users.tipo = membro`, `Moradores.tipo = proprietario`.
- Web mostra "Proprietário"; app (lê `Apartamentos_Users`) lista em "Família".
- A edição de vínculo atual no web sincroniza as duas tabelas (testado) → provavelmente dado legado. Corrigir o registro e auditar outros casos divergentes.

### 3. 🟠 Telefone do cadastro web não é gravado em `Moradores`
- Inquilino criado pelo web com telefone → `Moradores.telefone = null`.
- Coluna "Contato" mostra "—" e o formulário de edição abre com telefone vazio (o app mostra o telefone, vindo de `Users`).

### 4. 🟡 Contadores da Home do app só atualizam reabrindo o app
- Após nova encomenda, Home continua "1 aguardando retirada" mesmo com pull-to-refresh; dentro do condomínio mostra 2 (correto). Fechando e abrindo o app, a Home mostra o valor certo.

### 7. 🟠 Lista de ocorrências do app não recarrega após criar
- Morador abre ocorrência → volta para a lista → "Nenhum registro encontrado", e pull-to-refresh não resolve.
- `list_ocorrencias_todos.dart` só chama `loadList()` no `initState`; o `.then(setState)` do `ListOcorrencias` não recarrega as abas filhas. Sair e entrar na tela mostra a ocorrência.
- A ocorrência chega no web normalmente.

### 8. 🟠 Sem push em comunicado e em resposta/status de ocorrência
- `ComunicadosService.create` não envia push (a notificação só aparece in-app, derivada).
- `OcorrenciasService.updateResposta` e `updateStatus` não enviam push ao autor (só atribuição e chat enviam).

### 10. 🟠 App lista reserva cancelada como agendamento ativo
- Salão de Festa: reserva 28/09 14:00–18:00 está **cancelada** no web, mas aparece na lista "Agendamentos" da área no app, sem status — o morador acha que o horário está ocupado/que ainda tem a reserva.

### 11. 🟡 `horarios_livres` só remove slot com horário idêntico
- `areas-sociais.service.ts:585` compara `horarioDe === horaDe && horarioAte === horaAte`. Uma reserva ativa 14:00–18:00 não remove o bloco 08:00–23:59 da lista de livres; o app oferece e só o POST (checagem de sobreposição em `insertAgendamento`) recusa. Deveria filtrar por interseção.

### 12. 🟡 Placa de veículo sem validação de formato
- Web aceitou placa "X1" (e já existe "ABC123", 6 caracteres). Deveria exigir padrão antigo `AAA9999` ou Mercosul `AAA9A99`.
- Duplicidade funciona (bloqueia "x1" normalizando para "X1").

### 13. 🟡 Busca de morador no modal de veículo ignora sobrenome parcial
- "Vinicius Fam" lista todos os "Vinicius" (Gomes, Pereira, Silva...), não só "Vinicius Família".

### 14. 🟠 Enquete aceita término antes do início
- Web: "Nova Enquete" com início 28/09/2026 e término 20/09/2026 foi criada e já nasce "ENCERRADA". Deveria bloquear no front e no backend.

### 15. 🟡 Contador "Enquetes Comunitárias" mostra 0 até abrir a aba
- Em /assembleias o badge exibe 0 e só atualiza (2, depois 3) ao interagir com a página.

### 19. 🟠 Selo "X no local" do card do condomínio mostra visitas do dia
- Home do app: "2 no local" com apenas 1 visitante dentro (o outro só foi liberado e nunca entrou).
- `list_condominiums.dart:1900-1910`: sem `no_local`/`inside_condo`/`visitantes_ativos`/`moradores_no_local` na resposta, o fallback usa `visits_today`/`visits` — conta visitas agendadas como presença.

### 16. 🟡 Janela de visitante do app sem fuso horário
- Com o emulador em UTC, o app gerou liberação "28/09 19:12–22:12" e o PIN no web respondeu "o período de validade deste código ainda não iniciou" às 16:14 de Brasília. O app envia a hora do aparelho sem fuso, e o backend interpreta como Brasília.
- Em aparelho no fuso de Brasília não aparece, mas moradores em outros fusos do Brasil (AM, MT, MS, AC, RO, RR) ou com celular em fuso diferente terão a janela deslocada. Confirmado: `new_visitante.dart:264` envia `inicio?.toString()` (ex.: `2026-09-28 19:12:00.000`), sem offset.

### 17. 🟡 Status "Liberado" para visita que ainda não começou
- Na lista de visitantes do web, "Teste Claude Visita App" aparece como "Liberado" mesmo com a janela ainda não iniciada (o PIN é recusado). Deveria ser "Agendado".

### 18. 🟡 Textos
- Mensagem de erro do app de visitante cita "Liberado até"/"Liberado a partir de", mas os campos no app chamam "Data e hora de término/início da liberação".
- Web Delivery: status "AGUARDANDO AUTORIZACAO" sem acento.
- App Financeiro: "BRL 0,00" em vez de "R$ 0,00".
- App: "Bloco Bloco A" (prefixo duplicado) no Meu Apartamento e no card do condomínio da Home.

### 9. 🟡 Polling agressivo em /ocorrencias no web
- ~8 GETs em `/condominios/1/ocorrencias` em menos de 1 minuto com a página aberta.

### 5. 🟡 Cadastro de menor com e-mail no web
- O formulário já exibe "Credenciais de acesso bloqueadas", mas envia o e-mail e recebe 400. Deveria desabilitar/limpar e-mail e o checkbox de credenciais para menor.

### 6. 🟡 Formulário de familiar no app
- CPF sem máscara/validação visual.
- Seletor de data de nascimento aceita datas futuras.
- Voltar descarta o formulário sem confirmar.

## Não confirmado
- **Push**: funciona (chegaram "Chegada de Visitante" e "Nova Encomenda"), mas o de encomenda chegou ~12 min atrasado. O emulador oscilava "no signal"; confirmar a latência em aparelho real.
- Push de "Reserva Aprovada" não chegou em ~2 min (o código em `updateStatusAgendamento` envia). Mesmo atraso do FCM do emulador — conferir depois.
- **E-mail de credenciais** para os aliases `viniciusvilelarufini+...` — Gmail conectado é outra conta. SMTP funciona (e-mail de recuperação de senha chegou 18:34).

## Funcionou
- Encomenda web → notificação in-app imediata; lista de encomendas correta.
- Regra LGPD de menor de idade (bloqueia conta/biometria).
- Cadastro de dependente e inquilino no web → aparecem no app no apto certo.
- Edição de vínculo no web → reflete no app.
- Publicação de comunicado (aparece in-app).
- Visitante: validação "Liberado até" < "a partir de"; cadastro + check-in → evento e push "Chegada de Visitante" no app.
- Ocorrência aberta no app → aparece no web com SLA; resposta pública → "Ocorrência respondida" in-app.
- Enquete: criada no web aparece no app; voto registra, trocar de opção não duplica; enquete finalizada bloqueia voto.
- Visitante pelo app: validação de campos obrigatórios e de término ≤ início; PIN gerado e visitante aparece no web; PIN inválido é recusado no web.
- Remover morador no web (dependente de teste) → some do Meu Apartamento no app.
- Veículo: placa duplicada bloqueada (case-insensitive).
- Reserva de área social no app: capacidade validada (50 > 20 bloqueado); reserva criada fica pendente no web; aprovação pelo web OK.

## Dados de teste criados
Encomenda #5, "Teste Claude Inquilino" (agora proprietário), comunicado "Teste Claude comunicado 28/09", visitantes "Teste Claude Visitante" (com entrada) e "Teste Claude Visita App" (PIN 460-321), ocorrência #7 respondida, reserva Salão de Festa 28/09 08:00–23:59 aprovada, veículo "X1", enquetes "Teste Claude: pintar a fachada?" (encerrada) e "Teste Claude: trocar o portao?" (1 voto).
"Teste Claude Dependente" foi criado e depois removido.
