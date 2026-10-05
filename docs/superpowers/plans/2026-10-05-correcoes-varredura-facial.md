# Correções da varredura do facial (05/10/2026) — Plano

Spec: nenhum documento separado; os requisitos são os 5 achados da varredura de 05/10/2026 descritos em cada tarefa.

## Global Constraints

- Monorepo Nx em `click-cond-web/`. API: `apps/api` (NestJS). Front: `apps/portaria-web` (Angular). Não mexer em `crm-web`, no agente (`agent/`) nem no app Flutter.
- Não rodar Docker nem banco local. Não aplicar SQL. Nenhuma tarefa exige coluna nova no banco.
- Testes da API: `npx jest --config apps/api/jest.config.cts <caminho-ou-padrão>` a partir de `click-cond-web/`. Specs do facial vivem em `apps/api/src/app/facial/*.spec.ts` e usam `jest.useFakeTimers()` porque o construtor do `FacialService` arma `setTimeout`/`setInterval` — siga o padrão dos specs vizinhos (ex.: `tick-fantasmas.spec.ts`, `historico-acesso-escopo.spec.ts`).
- Testes do front: `npx nx test portaria-web --testFile=<arquivo>` (ou `npx jest --config apps/portaria-web/jest.config.ts <arquivo>`); build: `npx nx run portaria-web:build`.
- A flag da modelagem nova é `PESSOAS_MIGRATION_ENABLED` (`pessoasMigrationEnabled(this.prisma)` em `facial.service.ts`). Todo comportamento novo para `Pessoas`/`Visitas` vale só com a flag ligada; com a flag desligada o comportamento atual não muda.
- IDs: `Pessoas.id` ≥ 2.000.000 e `Visitas.id` ≥ 1.000.000 (offsets SQL). Nunca resolver um id de uma tabela contra a outra.
- Textos de UI em português do Brasil, com acentuação correta.
- Commits pequenos, mensagem em pt-BR no padrão `fix(<escopo>): ...`, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comentários no estilo do arquivo (o `facial.service.ts` explica o PORQUÊ em português; mantenha essa densidade, sem exagerar).

## Task 1: Varredura de fantasmas — status real por condomínio

Problema: `tickFantasmas` (`apps/api/src/app/facial/facial.service.ts`, ~linha 3493) grava `lastFantasmasRunAt = new Date()` no INÍCIO do tick, global para o processo. Falha de `listUserIds`/`removeUsers` num aparelho (terminal offline) vai só para `logger.warn`. `getHealthSummary` (~linha 558) devolve `fantasmas.ultimaVarreduraEm` = esse timestamp global, e o portal mostra "Nada a remover hoje · Última varredura há X min" mesmo quando o único terminal do condomínio não pôde ser varrido.

Requisitos:
1. Guardar, por condomínio, o resultado da última varredura (em memória, mesmo padrão efêmero atual): quando terminou, quantos terminais foram varridos com sucesso e a lista dos que falharam (`{ id, nome, erro }`, erro truncado a ~200 caracteres). Um aparelho com lista vazia (`idsNoAparelho.length === 0`) conta como varrido com sucesso.
2. `getHealthSummary(idCondominio).fantasmas` passa a trazer, além de `removidosHoje` e `eventosHoje` (inalterados): `ultimaVarreduraEm` = quando a varredura daquele condomínio terminou (null se ainda não rodou para ele), `terminaisVarridos: number` e `terminaisComFalha: { id, nome, erro }[]`. Remover a dependência do timestamp global (`lastFantasmasRunAt` pode sair).
3. Portal (`apps/portaria-web/src/app/terminais-faciais/`): o card "Limpeza de biometria órfã" mostra estado de ALERTA (mesma linguagem visual/cor do card "Terminais" quando há offline) quando `terminaisComFalha.length > 0`, com texto do tipo "Varredura falhou em N terminal(is)" e o nome do(s) terminal(is) na linha de detalhe. Só mostra "Nada a remover hoje" quando houve varredura sem falhas. Sem varredura ainda para o condomínio: texto neutro "Aguardando primeira varredura". Atualizar a interface TypeScript do health summary no service do front.
4. Testes: em `tick-fantasmas.spec.ts` (ou spec novo ao lado) — um aparelho que lança em `listUserIds` aparece em `terminaisComFalha` e não conta em `terminaisVarridos`; um aparelho ok conta como varrido; condomínios diferentes não se misturam. Spec do componente do front se já existir um para essa página; senão, teste do helper de apresentação se você extrair um.

## Task 2: "Remover rostos dos terminais" inclui Pessoas

Problema: `unsyncAllForCondominio` (`facial.service.ts`, ~linha 3141, chamado por `POST /facial/sync/clean`) só consulta `moradores`, `visitantes` e `prestadores_servico`. Com a flag ligada, visitantes/prestadores vivem em `pessoas` (face_id `pessoa_<id>`) e continuam no aparelho depois da limpeza.

Requisitos:
1. Com `pessoasMigrationEnabled(this.prisma)` e a categoria permitindo (mesma lógica de `pessoaTipoWhere` usada em `syncAllForCondominio`, ~linha 3027: sem filtro → todos; só `prestador` → `tipo_pessoa: 'prestador'`; só `visitante` → `tipo_pessoa: { not: 'prestador' }`), buscar `pessoas` do condomínio com `face_id` não nulo e removê-las via `unsyncPessoa(id, face_id, idCondominio, { deviceIds })`.
2. Mesmo tratamento de `keepFaceId` das outras fontes: `keepFaceId` → `face_sync_status: 'pending'`; senão zera `face_id`, `face_sync_status` (e `face_sync_error`/`face_enrolled_at` se existirem no model `pessoas` — confira no `prisma/schema.prisma`).
3. Contar as pessoas no `total` retornado e no log de ok/falha.
4. Respeitar o retorno booleano de `unsyncPessoa`: se a remoção não chegou a todos os terminais (false), NÃO zerar o face_id — marcar `face_sync_status: 'pending'` e contar como falha (mesma regra de `syncPessoa`, ~linha 2343).
5. Testes num spec novo `facial.unsync-all-pessoas.spec.ts`: com flag ligada, pessoas entram e são removidas; com flag desligada, `pessoas` não é consultada; categoria `prestador` filtra `tipo_pessoa`; remoção que falha mantém face_id com status `pending`.

## Task 3: Gestão de terminais só para síndico

Problema: o portal esconde "Configurações" do porteiro só no menu (`shell/sidebar.component.ts`, `isPorteiro` = `turno` ≠ 'Síndico'). As rotas `/configuracoes` e `/terminais-faciais` têm só `authGuard`, e o `FacialController` usa só `assertTenantStrict`, que aceita qualquer token do console. Um porteiro consegue criar/editar/remover terminal, rotacionar token do webhook, baixar a configuração do agente e limpar rostos.

Fato do código: o token de síndico no console carrega `typeAccess: 'Sindico'` (resolvido no banco em `auth.service.ts` `montarSessaoPortaria` e no login de síndico); o de porteiro não tem `typeAccess` (ou tem turno 'Porteiro (App)' com typeAccess de funcionário no login por QR).

Requisitos:
1. API: criar em `apps/api/src/app/auth/tenant.util.ts` a função `assertSindico(user, contexto)` que lança `ForbiddenException` com mensagem em pt-BR ("Acesso negado: <contexto> exige síndico.") quando `typeAccess` (de `user.typeAccess ?? user.user?.typeAccess`, comparado sem diferenciar maiúsculas) não for `sindico`.
2. Aplicar `assertSindico` (depois do `assertTenantStrict` existente) em: `POST devices`, `PUT devices/:id`, `DELETE devices/:id`, `POST devices/:id/rotate-token`, `POST sync/clean`, `GET agent/config`, `GET agent/info` se ele devolver token/segredo do agente (confira o service), e nas rotas de descoberta que alteram dados (`descobertos/procurar` pode continuar operador — ela só dispara busca; decida pela leitura e justifique no relatório). Rotas operacionais continuam liberadas ao operador: listar dispositivos, health, testar, snapshot, câmera, `devices/:id/trigger` (abrir porta é tarefa do porteiro), sync/status, sync/pessoas, sync/all, enroll, acessos.
   - Se "Desativar/Reativar" terminal passar por `PUT devices/:id`, fica restrito ao síndico junto.
3. Front: guard de rota (`apps/portaria-web/src/app/auth/`) que redireciona o porteiro para `/dashboard` ao entrar em `/configuracoes` e `/terminais-faciais` — mesma regra de `isPorteiro` do sidebar (turno presente e diferente de 'Síndico'). Extrair essa regra para um único lugar reutilizado pelo sidebar e pelo guard. Financeiro e relatórios (também escondidos do porteiro no menu) recebem o mesmo guard.
4. Testes: spec da API (novo `facial.controller.sindico.spec.ts` ou junto de um spec de controller existente) — porteiro (token `{ sub, nome, id_condominio, turno: 'Diurno' }`) recebe 403 em `DELETE devices/:id` e `GET agent/config`, e passa em `devices/:id/trigger`; síndico (`typeAccess: 'Sindico'`) passa em todas. Spec unitário de `assertSindico`. Spec do guard do front.

## Task 4: Ticks de expiração, pré-enrolamento e dias da semana cobrem Pessoas

Problema: com a flag ligada, `tickExpiracaoAutomatica`, `tickPreEnrolamento` e `tickDiasSemanaSync` (`facial.service.ts`, ~linhas 3303-3478) só consultam `Visitantes` e chamam `syncVisitante`, que com a flag devolve `skipped`. Hoje só o `tickSyncRetry` (30 min, e apenas com agente online) cobre Pessoas, via `syncAllForCondominio({ onlyPending: true })`.

Requisitos (todos só com `pessoasMigrationEnabled`; com a flag desligada nada muda):
1. `tickExpiracaoAutomatica`: além do bloco atual, buscar `pessoas` com `face_id` não nulo que tenham alguma visita com `data_hora_termino < agora` e chamar `syncPessoa(pessoa.id)` — ela recalcula a autorização pela janela e remove o rosto quando nenhuma visita autoriza. NÃO alterar `Visitas.liberado` neste tick (diferente do caminho legado): zerar `liberado` de quem ainda está DENTRO tiraria o rosto também do leitor de saída. Deduplicar ids de pessoa.
2. `tickPreEnrolamento`: buscar `pessoas` com `foto_pessoa` não nula, `face_id` nulo e alguma visita `liberado: 1` com `data_hora_inicio` entre agora e agora+30min; chamar `syncPessoa`.
3. `tickDiasSemanaSync` (roda só na hora 0 BRT): buscar `pessoas` com foto ou face_id que tenham alguma visita com `dias_semana` não nulo e chamar `syncPessoa`.
4. Contadores ok/skipped/falhou e log no mesmo formato dos blocos de visitantes vizinhos.
5. Atualizar o comentário TODO acima de `pushPessoaToDevices` (~linha 2492): o item 1 deixa de ser verdade; manter o item 2 (visitas sobrepostas) se ainda for verdade. Atualizar também o comentário "Important 4 (Lote B)" dos ticks para refletir que Pessoas agora é coberta.
6. Testes num spec novo `facial.ticks-pessoas.spec.ts`: para cada tick, com flag ligada a pessoa elegível recebe `syncPessoa` e a não elegível não; com flag desligada `pessoas` não é consultada; o tick de expiração não chama `visitas.update`/`updateMany`.

## Task 5: Ícone do Delivery e formato "Apto/Bloco"

1. `apps/portaria-web/src/app/shell/sidebar.component.html`: o `@switch (item.path)` dos ícones não tem `@case ('/delivery')`, então o menu mostra a letra "D". Adicionar o case com um SVG no mesmo estilo (tamanho, stroke, classes) dos vizinhos — um ícone de moto/entrega ou caixa com seta; também verifique se existe o mesmo `@switch` em outro lugar (menu mobile/colapsado) e cubra lá também.
2. `apps/api/src/app/dashboard/dashboard.service.ts` (linhas ~438, 470, 497, 649, 659, 665): o texto concatena `Apto ${apto}${bloco}` sem separador e o campo bloco guarda valores como "Bloco A", gerando "Apto 108Bloco A". Criar um helper puro (no próprio arquivo ou em `apps/api/src/app/common/`) `formatarApto(apto, bloco)`: sem bloco → `Apto 108`; bloco que já começa com "bloco" (sem diferenciar maiúsculas) → `Apto 108 · Bloco A`; bloco curto como "A" → `Apto 108 · Bloco A`; apto vazio/nulo → string vazia ou só o bloco, sem "Apto " solto (preserve o `.trim()` atual). Usar nos 6 pontos.
3. Testes: spec unitário do helper cobrindo os casos acima. Build do portaria-web passando.
