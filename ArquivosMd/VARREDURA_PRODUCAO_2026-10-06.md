# Varredura em produção — 06/10/2026

Ambiente: produção, condomínio **Boa vista** (teste).
Web: síndico (`suporte@clickprestarecondominios.com.br`). App: emulador Pixel_10, morador VINICIUS VILELA RUFINI (Apto 106, Bloco A).
Status: **só investigação** — nenhuma correção feita ainda.

## Dados de teste criados (marcados "Teste Claude")
- Reserva: Churrasqueira Gourmet, 13/10/2026 10:00–16:00, 10 convidados (aprovada).
- Ocorrência #9: "Teste Claude 06/10: barulho no apto de cima apos as 22h" (Barulho e convivência), resposta pública + status Ciente.

## Áreas Sociais / Reservas

### OK
- Validação de capacidade no app (30 convidados em área de 25 → alerta "comporta no máximo 25 pessoas").
- Só dias/horários configurados são oferecidos (segundas e terças).
- Reserva app → web chega como pendente com dados corretos.
- Aprovação web → app mostra "Aprovado por … (data)".
- Horário aprovado some das opções (sem reserva duplicada).

### Achados
| # | Achado | Onde | Tipo |
|---|--------|------|------|
| 4 | Card do agendamento na tela da área não mostra status (pendente/aprovado); só aparece em "Meus Agendamentos" | app | UX |
| 5 | Bloco cinza (skeleton) nunca carrega na tela da área social, ao lado de "Necessita de Autorização" | app | bug |

## Ocorrências

### OK
- Ocorrência app → web com SLA ("Vence em 47h"), prioridade e autor corretos.
- Resposta pública web → app aparece no detalhe.
- Ocorrências privadas de outro autor não aparecem para o morador (esperado).

### Achados
| # | Achado | Onde | Tipo |
|---|--------|------|------|
| 1 | Datas cruas no detalhe: "2026-10-06T12:34:56.000Z" na resposta da administração e criação truncada ("2026-10-06T12…") | app | formatação |
| 2 | Status "Ciente" na web aparece como "Em andamento" no app — confirmar se é intencional | web ↔ app | dúvida |
| 3 | Lista não atualiza sozinha (continuou "Pendente"); puxar-para-atualizar não funcionou. Só atualiza reabrindo a tela | app | bug |
| 6 | Ocorrência #5 "facial principal offline" pendente desde 25/09; #1–#4 foram resolvidas sozinhas. Verificar se o dispositivo está mesmo offline ou se o auto-resolve falhou | backend | investigar |

## Encomendas

Dados de teste: #8 "Teste Claude 06/10 caixa Shopee" (recebida na web, retirada pendente) e #9 "Teste Claude aviso app" (avisada pelo app, recebida e retirada pela web — concluída).

### OK
- Web: validação de campos obrigatórios; encomenda recebida chega no app como "Aguardando retirada" com transportadora e horário corretos, já notificada.
- App: "Avisar Encomenda" tem validação inline ("Campo obrigatório"); chega na web como "A chegar" (#9).
- Web "Receber" (a chegar → aguardando) e "Marcar retirada" (modal exige nome de quem retira) → app mostra em "Entregues" com "Retirada por … hoje às 09:41".

### Achados
| # | Achado | Onde | Tipo |
|---|--------|------|------|
| 7 | Banner vermelho "Descrição e apto destinatário são obrigatórios." continua na tela depois de cadastrar com sucesso (erro nunca é limpo) | web | bug |
| 8 | Mensagem de erro de validação aparece abaixo do formulário, fora da tela, longe do botão | web | UX |
| 9 | App não atualiza encomendas ao navegar entre abas — só após fechar e reabrir o app (mesma causa provável do achado 3). Contador do início só atualizou após reiniciar | app | bug |
| 10 | Encomenda "A chegar" mostra "06/10 09:40" na coluna "Recebida" mesmo sem ter chegado | web | UX |
| 11 | A lista web tem botões duplicados (versão mobile oculta no DOM); `getByRole('button').first()` pega o oculto — afeta automação/testes, não o usuário | web | nota de teste |

### Falso positivo descartado
- Horários do app 3h adiantados: era o emulador em UTC. Ajustado para America/Sao_Paulo e os horários passaram a bater com a web.

## Comunicados

Dado de teste: "Teste Claude comunicado 06/10".

### OK
- Publicar na web → aparece no app (lista + detalhe com data) e gera notificação "Teste Claude comunicad… NOVA" na central.
- Validação de título obrigatório; banner de erro some após publicar com sucesso (diferente de Encomendas).

### Achados
| # | Achado | Onde | Tipo |
|---|--------|------|------|
| 12 | Não há como editar nem excluir comunicado (nenhum botão de ação) — impossível apagar os comunicados de teste | web | funcionalidade |
| 13 | Dashboard mostra "Comunicados: Nenhum ativo" com 2 publicados (provável regra de "últimos 7 dias"; confirmar) | web | dúvida |
| 14 | Lista de comunicados no app não mostra data (só no detalhe) | app | UX |

## Notificações (central do app)
- Chegaram: comunicado, encomenda recebida (#8), encomenda retirada (#9), ocorrência respondida, reserva aprovada.

| # | Achado | Onde | Tipo |
|---|--------|------|------|
| 15 | Encomenda #9 (avisada pelo app, depois "Receber" na web) aparece como "Notificado 09:40" na web, mas **não gerou** notificação "Encomenda recebida" no app (só a #8, cadastrada direto, gerou) | backend | investigar |
| 16 | Mudança de status da ocorrência (Pendente → Ciente) não gerou notificação; só a resposta pública gerou. Confirmar se é intencional | backend | dúvida |

## Visitantes / Portaria

Dado de teste: visitante "Teste Claude Visitante 0610" (PIN 247-729), entrada e saída registradas pela web.

### OK
- App: cadastrar visitante (início/fim da liberação, tipo, apto) → "Liberação Gerada" com PIN 247-729.
- Web: Validar PIN mostra visitante, destino, autorizado por e período; Confirmar Entrada → app mostra "No local (2)" com "Entrou agora" e o PIN; Dar Baixa na web → app volta a "No local (1)".
- Pull-to-refresh funciona na lista de visitantes do app.

### Achados
| # | Achado | Onde | Tipo |
|---|--------|------|------|
| 17 | Contadores do app não batem com a web: app "Todos (27) / Visitantes (27)" vs web "Total registrado 10"; "Cadastrados (6)" | app | bug |
| 18 | Vinicius Vilela está "No condomínio" desde 04/10 11:45 (2 dias) sem saída registrada — pode ser dado de teste esquecido, mas mostra que não há expiração/alerta de visitante dentro há muito tempo | dados / produto | dúvida |
| 19 | Lista de visitantes do app não atualiza ao trocar de aba; só após pull-to-refresh | app | UX |
| 20 | Rótulo da aba inferior muda de "Visitantes" para "Cadastrar" quando selecionada | app | UX |

## Correções ao que já estava neste relatório
- **Achado 3 (ocorrência não atualiza): falso positivo.** O status só mudou na web depois que confirmei o diálogo "Alterar"; eu puxei a lista antes. Depois disso o app mostrou "Em andamento". Fica só a observação geral do achado 19 (listas não refazem a busca ao trocar de aba; pull-to-refresh resolve).
- **Achado 9 (encomendas)** também se resume a isso: faltou eu ter testado o pull-to-refresh antes de reiniciar o app.

## Pendências de varredura (não testadas)
Delivery, Assembleias, Enquetes, Manutenções Programadas, Agendar Mudança, Financeiro, Prestadores, Veículos/vagas, Moradores/Apartamentos (CRUD), Relatórios, Documentos, Configurações; permissões/segurança (morador vendo dado de outro); Playwright em viewport mobile.

## Correções feitas (branch `fix/varredura-producao-2026-10-06`, ainda não enviada)
Plano: `docs/superpowers/plans/2026-10-06-correcoes-varredura-producao.md`. Revisão final: sem Critical/Important.

| Achado | Commit | Resultado |
|---|---|---|
| 7, 8, 10 (Encomendas web: erro não limpa, fora de vista, "Recebida" em "A chegar") | 50389fa2 | corrigido, 230 testes do portaria-web passando, build ok |
| 15 (feed: encomenda "Esperando" aparecia como "chegou") — o achado original era falso positivo, mas revelou este bug | 88f3c59e | corrigido, jest 4/4 |
| 17 (contadores do app contavam visitas) | 7a79864c | corrigido, testes Flutter |
| 1 (datas ISO cruas na ocorrência) | 35b725e4 | corrigido, testes Flutter |
| 5 (bloco de clima sem fim) | 904b6e36 | timeout de 8s; sem teste (método privado do State) |

Descartados/sem código: 3 (falso positivo), 6 (auto-resolve correto; o dispositivo está mesmo offline), 9 (era a mesma causa do 19, só cache de aba).
Pendentes de decisão: 2 (Ciente × Em andamento), 12 (editar/excluir comunicados), 13, 18.
Follow-ups sugeridos pela revisão final: `formError` separado para validação do form de Encomendas; usar `recebido_em` como timestamp do feed quando sair de "Esperando"; relatórios mostram `recebido_em` como "dataEntrada" para "Esperando".

## Fase 2 das correções (pendências decididas pelo controlador)
Plano: `docs/superpowers/plans/2026-10-06-correcoes-varredura-fase2.md`. Revisão final: sem Critical/Important. Verificação final: portaria-web completo verde; API `mobile-auth|relatorios|dashboard` 19 suítes / 96 testes verdes.

| Pendência | Decisão | Commit |
|---|---|---|
| 12 Editar/excluir comunicado | Era falso positivo: botões existiam, mas só no hover (invisíveis em toque). Agora sempre visíveis | bc3eefd0 |
| 13 Dashboard "Nenhum ativo" | Rótulo errado (conta 7 dias). Agora "Nenhum nos últimos 7 dias" | d480fca6 |
| Encomendas: `formError` separado + erro de ação limpo ao tentar de novo/recarregar | feito | 6194a0eb, 2c0c4109 |
| Feed: timestamp usa `retirado_em ?? recebido_em ?? created_at` | feito | 81bd50d4 |
| Relatórios/dashboard: "Esperando" não mostra data de recebimento (tela, xlsx, pdf, dashboard) | feito; modal do dashboard mostra "A chegar" | 79c71ca2, 15f45c42, 86751aa2 |
| 2 "Ciente" × "Em andamento" | Mantido: mapeamento intencional do app | — |
| 18 Visitante "No condomínio" desde 04/10 | Dado de teste; sem expiração automática (mexe em controle de acesso, decisão de produto) | — |

Itens adiados (Minor): `remover()` de encomendas sem tratamento de erro; `quando` de `getEventos()` ainda usa `recebido_em` para Esperando; feed usa janela de 30 dias por `created_at` (encomenda avisada há >30 dias e recebida hoje não aparece); helper `isEsperando` repetido em 4 lugares; hack de locale `ɵfindLocaleData` nos specs do dashboard.
