# Correções da varredura de 24/11/2026 — registro do branch fix/varredura-2026-11-24

Base 954e2fd8 (produção). 15 tarefas do plano docs/superpowers/plans/2026-11-24-correcoes-varredura.md, cada uma com revisão própria, mais revisão final do branch inteiro e onda de correção. Nada publicado, nenhum SQL aplicado.

## Decisões tomadas pelo controlador (Ruling)
- Ruling: Q2, R4, G1, G4, S2, S4, S5, S6, D10, K5, I4, T4(SSRF), V4, R7 fora do plano — dependem de chave fora do GitHub, fluxo novo de app, bancada ou escrita no ERP real — custo: ficam abertos, listados no relatório.
- Ruling: adoção de conta órfã = adotar com reset de senha + revogação + credencial ao e-mail (prova de posse por entrega), em vez de fluxo de convite — porque não quebra o onboarding do síndico autocadastrado — custo se errado: síndico que se autocadastrou recebe senha nova por e-mail uma vez.
- Ruling: 3 implementadores em paralelo (pedido do usuário, sobrepõe a regra do skill) — cada frente no seu worktree/branch a partir de 954e2fd8, tarefas com arquivos disjuntos; merge das frentes no branch fix/varredura-2026-11-24 no fim — custo: conflitos de merge em mobile-auth/schema resolvidos à mão.
- Ruling: regra de conta órfã também no sendCredentials ("Enviar acesso") — mesmo vetor do W1 — custo: reverter um ramo se o usuário discordar.
- Ruling: match só por CPF recusado inclusive para dependente sem e-mail com conta existente — seguro; cadastro passa a exigir o e-mail — custo: um passo a mais no cadastro raro.
- Ruling: e-mail do CRM usa modelo sendForgotPassword — não há modelo de boas-vindas de síndico — custo: texto do e-mail genérico.
- Ruling: na definição de conta órfã e na recusa de "outro condomínio" usada pela adoção, vínculo que aponta SÓ para condomínio pendente (ativo=0 e aprovado_em null) não conta — o brief (texto meu) induziu a brecha — custo: síndico com autocadastro pendente legítimo ligado por outro caminho recebe senha nova por e-mail.
- Ruling: G3 com frame_hex no where da reivindicação (sem coluna nova); G5 também recusa trocar tipo; G6 aceita unidade do morador ou do frame confirmado — dentro do brief — custo baixo.
- Ruling: cobrança local com status '2' (comprovante em análise) NÃO é aposentada pelo S1 — o sync já preserva '2' e o síndico não pode perder o aviso — custo: uma '2' cancelada no ERP fica até a auditoria do comprovante.
- Ruling: aposentada usa status '3' (mesmo do renegociado) — todas as consultas de dívida já excluem — custo: perde a distinção cancelado×renegociado no banco.
- Ruling: aposentadoria do S1 atrás de env SUPERLOGICA_APOSENTAR_SUMIDAS (padrão desligado) até conferir no "teste Api prestare" — custo: até ligar, cobrança cancelada continua pendente (comportamento atual).
- Ruling: opção (a) — externalId no updatePerson só para família control_id — funciona também com o agente antigo — custo: nenhum para Dahua/Hikvision (volta ao comportamento anterior).
- Ruling: rebalanceamento — A: T2 (em revisão), T3, T4, T6; B: T14 (fix), T10, T15; C: T5, T9 — arquivos disjuntos por frente na medida do possível — custo: mais conflitos de merge em mobile-auth.service.ts.
- Ruling: teto GLOBAL de locks de pessoa simultâneos no processo (semáforo em comLockDaPessoa, padrão 6, configurável por env FACIAL_LOCKS_PESSOA_MAX), esperando dentro do mesmo prazo de 30 s antes de virar pending — protege todos os chamadores e compõe com o limite por condomínio da T14 no merge — custo: syncs em massa ficam mais lentos (fila).
- Ruling: P3 no legado recusa "Liberar" de quem está dentro ("Dê baixa antes…") em vez de zerar — é a trava do caminho novo — custo: um passo a mais para o porteiro.
- Ruling: K3 resposta do dono sem vínculo continua permitida (intencional no código, nuvem não abre portão) — decisão de produto fica para o usuário — custo: status AUTORIZADA visível à portaria.
- Ruling: T4 vai para a frente B (já mexeu em updateDevice no G5); T6 fica na A depois da T3 — custo: merge de facial.service.ts entre A e B.
- Ruling: W3 — cancelamento pelo operador ("perdeu o celular") também grava Users.senha_alterada_em (derruba sessões em todos os aparelhos da conta) — sem isso o aparelho perdido logado emite QR novo — custo: morador refaz login no aparelho novo.
- Ruling: sem linha de heartbeat ou com ultimo_poll_em nulo → desativar/excluir sem limpeza (nunca recebeu comando de cadastro); "falou um dia, IP errado agora" fica pendência declarada (sem botão forçar) — custo: esse caso raro ainda precisa de ajuda do suporte.
- Ruling: ⚠️ outros caminhos que gravam senha_alterada_em sem revogar na hora (funcionário, web changePassword, CRM, prestadores) ficam cobertos pela checagem na leitura — equivalente — custo: nenhum para o acesso.
- Ruling: T6 vai para a frente B (livre) — lock de área (area:apto) fica fora do lock de pessoa da frente A; ordem área→pessoa preservada — custo: merge de facial.service.ts.
- Ruling: toque no push 'financeiro' abre a tela com o id_condominio do push (parâmetro da tela), sem trocar o condomínio aberto — igual à autorização — custo: nenhum.
- Ruling: F6 só na entrada (saída não barrada) — quem está dentro precisa sair — custo: nenhum.
- Ruling: teto GLOBAL de locks de área no processo (padrão 4, env FACIAL_LOCKS_AREA_MAX) no wrapper do lock de área, como na T2; laços de manutenção/não-confirmação em sequência com dedupe por (área, apto) — custo: cancelamento em massa mais lento.
- Ruling: onda única de correção com tudo acima; decisões de produto (ATA avulsa, Liberar legado, K3, Guarita queimado) ficam para o usuário — custo: nenhum.
- Final: parked — remoção pós-exclusão sem lock tem janela curta (sync relê antes do DELETE e reenrola) — Ruling: troca aceitável frente à perda certa da remoção; tickFantasmas cobre em até 1 h; comentário a ajustar.
- Final: parked — credenciais.spec ainda pode casar '482913' no código aleatório (~1e-6) — Ruling: desprezível.
- Final: parked — unsyncAllForCondominio, reconcileAreaGating e syncs de área fora do teto global — Ruling: sequenciais; revisitar se aparecer fome no interativo em produção.

## Itens adiados (minor/deferred) e estacionados
- Task 1: minor (deferred): sendCredentials liga o cadastro antes de invalidar a posse, fora de transação (moradores.service.ts:1239 vs 1261).
- Task 1: minor (deferred): saveMorador invalida posse fora de transação (mobile-auth.service.ts:313).
- Task 1: minor (deferred): import duplicado de usuario-do-token.util em crm-condominios.service.ts:464/467.
- Task 1: minor (deferred): credenciais.spec intermitente (token aleatório casa regex /Ana/i).
- Task 7: minor (deferred): com agente antigo no ar, "desfazer" de RF da mesma unidade com contador andado apaga o controle do morador — publicar agente junto da API.
- Task 7: minor (deferred): Guarita queimado com tag remocao_falhou não pode ser desativado (409) — precisa saída explícita/decisão do dono.
- Task 7: minor (deferred): JSDoc de assertUmGuaritaPorCondominio ficou sobre o método novo (facial.service.ts ≈1427).
- Task 7: minor (deferred): apartamentos.findMany por evento no lote de recuperação (guarita-eventos.service.ts ≈602).
- Task 7: minor (deferred): G6 aceita unidade do frame confirmado além da do dono (decisão do implementador).
- Task 7: minor (deferred): tela não mostra "removendo do Guarita" (desfeito:false, removendo:true).
- Task 7: minor (deferred): corrida G7 perdedora já desfez a tag antiga antes do create falhar.
- Task 8: minor (deferred): getInadimplenteDetail passou a ordenar por vencimento também na tela do síndico.
- Task 8: minor (deferred): linhas digitáveis já velhas não são limpas (SQL opcional, decisão do dono).
- Task 1: minor (deferred): conta com vínculo ativo aqui + pendente fora deixou de ser "de outro condomínio" (create/saveMorador podem preencher login/senha vazios).
- Task 8: minor (deferred): NOT IN no updateMany não casa status NULL (lado seguro).
- Task 11: minor (deferred): download valida data antes do assert de papel (400 em vez de 403); filtros tipados como Record.
- Task 14: deferred (fora do escopo): eventos de acesso do Control iD ainda pelo id interno; NOSSO_EXTERNAL_ID sem pessoa_ (fantasmas de Pessoa no Control iD/Hikvision não limpos); modo direto do Control iD pelo id interno; Q6 no Dahua/Hikvision só reduz a janela (retry Digest em lib/http).
- Task 12: deferred: app/console ainda oferecem publicar ATA avulsa (agora 400 com mensagem); update de unidade sem dedup por chaveUnidade (também no console); listOcorrencias só um condomínio (pré-existente).
- Task 2: deferred (fora do escopo): comando já pego pelo agente e estourado na nuvem ainda pode rodar após a remoção.
- Task 14: minor (deferred): matrícula duplicada no Control iD atualiza só ids[0]; update cria usuário sem foto; id_condominio nulo vira cond:0; tickDiasSemanaSync agora sequencial entre blocos; teste Q6 Control iD frágil (push sobrescrito).
- Task 12: minor (deferred): saveApto agora devolve 409/404 do ApartamentosService (conferir se o app mostra message em 409); teste "morador atual recebe comunicados" com prova de falha fraca; PREFIXO_APURACAO acoplado à string do finish(); reindex RAG e vetores 768→512 continuam sem gatilho.
- Task 2: minor (deferred): Set refazendoAposRevogacao no módulo; pessoaAindaPodeTerRosto por terminal com lock preso; JSDoc órfão e linha dupla; commit falho após fn com sucesso aparece como falha; teste 5 consolida lacuna de foto nova.
- Task 14: minor (deferred): modo direto do removePerson compara fabricante sem normalizar; ehControlId solto entre docblock e @Injectable.
- Task 2: minor (deferred): revogação pela tela pode esperar até 30 s pela vaga com teto cheio; fotos.add duplicado; pending_removal sem tratamento próprio (depende do filtro != synced).
- Task 10: minor (deferred): janela sem FK entre DROP e ADD nos SQL de Vagas/Consentimentos (documentar passo manual ou ALTER único); importação (mobile-auth ≈5172-5181) engole P2002 e cria Moradores repetido; EXPLAIN na verificação; rajada D3 recusa também código certo.
- Task 5: minor (deferred): condição da trava duplicada (assertNegativaConhecida × gravarSemNegativaNova); where mira visita copiada; trava do modal sem finalize; comentário maior que o código; avisar dono da mudança do Liberar no legado.
- Task 15: deferred: dono sem vínculo com card já aberto só o vê sumir no tick de 2 h.
- Task 15: minor (deferred): incrementarSeAbaixo após 20 tentativas nega como se fosse limite; decrementar silencioso; delimitador <<<FIM DO DOCUMENTO>>> pode ser forjado no texto; TTL da cota não renova.
- Task 3: deferred: revogação nos eventos é best-effort fora da transação (leitura é a rede); passe da carteira precisa ser readicionado após trocar senha; fix 403 do app só com versão nova.
- Task 4: minor (deferred): Intelbras/Dahua apagam tudo do aparelho (igual tickFantasmas; comentar); marca sem listagem itera visitantes antigos (timeout HTTP); update/delete falho após limpeza deixa terminal vazio (agendarCarga no catch); auditoria do controle mistura áreas; teste chama updateDevice 2x.
- Task 3: minor (deferred): minha não confere unidade atual (QR que nunca abre p/ staff sem unidade, inalcançável pelo app); 2 consultas a mais por leitura no portão; revogação nos eventos best-effort.
- Task 4: minor (deferred): delegate agente_Dispositivos_Estado sem guarda; lastSeen por instância.
- Task 3: minor (deferred): teste "linha sem conta não grava" fraco (toHaveBeenLastCalledWith); caso sem conta sem asserção de auditoria; updateMany fora de transação.
- Task 9: minor (deferred): finally sem setState no pré-registro; unidade sem Moradores cai no Moradores mais antigo (veículo com id_morador de outra unidade).
- Task 9: minor (deferred): financeiro aberto pelo push com app fechado só reconhece faturas pelo id_usuario (visual).
- Task 6: deferred: remoção dos não reservados no reconcileAreaGating sem marca de pendente; updateAgendamento sem checagem de conflito (fora do escopo).
- Task 6: minor (deferred): removeAgendamento aguarda o sync no HTTP (pode dar 504 com lock ocupado); marca gravada fora do lock; F6 age também sobre 'negado'; faltam testes de borda de F6; chave do lock da criação vem do texto; custo da marca com agente offline.
- Task 6: minor (deferred): marcarAreaPendente segura a vaga no catch; JSDocs descolados (facial ≈219, areas-sociais ≈162).
- Final: parked — remoção pós-exclusão sem lock tem janela curta (sync relê antes do DELETE e reenrola) — Ruling: troca aceitável frente à perda certa da remoção; tickFantasmas cobre em até 1 h; comentário a ajustar.
- Final: parked — credenciais.spec ainda pode casar '482913' no código aleatório (~1e-6) — Ruling: desprezível.
- Final: parked — unsyncAllForCondominio, reconcileAreaGating e syncs de área fora do teto global — Ruling: sequenciais; revisitar se aparecer fome no interativo em produção.

## Pendências e decisões abertas
- Nota: credenciais.spec "passes/publico" intermitente na suíte cheia (passa sozinho) — observar nas próximas rodadas.
- Pendência de deploy: SQL 2026-11-24-guarita-tag-unica.sql no RDS antes do deploy; publicar agente novo.
- Pendência de deploy: SUPERLOGICA_APOSENTAR_SUMIDAS fica desligada até conferir o filtro no "teste Api prestare".
- Nota de merge: T14 adicionou externalId em ~18 chamadas removePerson/updatePerson dentro de sync/unsync em facial.service.ts; T2 (frente A) envolve esses métodos em lock — conflito esperado, resolução mecânica.
- Decisão para o usuário: app (list_atas → NewDocument is_ata) e console oferecem "nova ATA" que agora dá 400; não há caminho para subir ATA de assembleia anterior ao sistema — esconder botões ou permitir ATA avulsa sem vínculo?
- Pendência de deploy: SQL 2026-11-24-{vagas-fk-set-null, consentimentos-set-null, apartamentos-users-unico, indices-pin-janelas, mfa-ddl} no RDS antes do deploy (rodar verificação de duplicatas de Apartamentos_Users antes).
- Nota: superlogica-sync.spec intermitente na suíte cheia (passa sozinho) — mesma família do credenciais.spec; checar na revisão final.
- Pendência de deploy: SQL D6 (reserva-id-user-set-null) imediatamente antes do deploy.

## Ordem de deploy recomendada (revisão final)
0. CloudShell na conta 850401152034 + túnel SSM. Rodar todas as `prisma/sql/2026-11-24-*-verificacao.sql` (só leitura); se houver duplicatas em Apartamentos_Users ou Tags (Guarita), deduplicar antes.
1. SQL seguros com o código antigo no ar: indices-pin-janelas, mfa-ddl, guarita-tag-unica, apartamentos-users-unico, vagas-fk-set-null, consentimentos-set-null. Rodar as verificações de novo.
2. Logo antes do push: reserva-id-user-set-null (D6).
3. API: push em master e main (quem publica é o deploy-api.yml do main); conferir "Verify deployed version". Não criar env nova (FACIAL_LOCKS_PESSOA_MAX, FACIAL_LOCKS_AREA_MAX e SUPERLOGICA_APOSENTAR_SUMIDAS têm padrão). Observar logs de "adiado", "sem vaga" e P2024/P2028 nas primeiras horas.
4. Agente: release nova na mesma janela da API.
5. Portaria-web (mesmo push, Amplify).
6. App por último (emulador primeiro; TestFlight só quando o dono pedir).
