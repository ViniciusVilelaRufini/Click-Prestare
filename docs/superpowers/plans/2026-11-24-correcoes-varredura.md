# Plano — correções da varredura de 24/11/2026

**Spec:** `docs/operacao/varredura-2026-11-24-systematic-debugging.md` (relatório da varredura; cada achado tem id, arquivo:linha, cenário e direção). Os ids abaixo (W1, Q1…) apontam para as seções dele.
**Base:** branch `fix/varredura-2026-11-24` criado de `origin/main` 954e2fd8, worktree `C:\w\varredura`.

## Global Constraints
- Código de produção: API NestJS em `click-cond-web/apps/api/src/app`, portaria-web Angular 21 zoneless em `click-cond-web/apps/portaria-web/src/app`, app Flutter em `click-cond-app/click-cond-app/lib`, agente em `click-cond-web/agent/src`. O Express (`click-cond-api`) é só dev: não mexer.
- Banco: o Prisma NÃO roda migrate em produção. Mudança de banco = arquivo SQL novo em `click-cond-web/prisma/sql/2026-11-24-<assunto>.sql` + `2026-11-24-<assunto>-verificacao.sql` (só SELECT/SHOW), idempotente, mais a mudança correspondente em `prisma/schema.prisma` e `npx prisma generate`. NUNCA aplicar SQL em banco nenhum.
- Padrões já existentes que a correção deve reutilizar: `comLock`/`executarComLock` (`common/lock-distribuido.ts`), `updateMany` com o estado lido no `where` e `count === 0` → 409/400 "já respondido", `hojeBrasilia()`/`parseLocalTimeToUTC` (`common/hora-brasilia.util.ts`), regra de posse de conta de `auth/tenant-access.service.ts:135-140`, `assertSindicoEstrito`/`assertOperador`/`assertStaff` (`auth/tenant.util.ts`), signals ou `markForCheck()` na portaria-web.
- Toda correção tem teste: spec jest novo ou ajustado ao lado do arquivo (padrão dos `*.spec.ts` existentes com Prisma falso), teste Dart em `click-cond-app/click-cond-app/test/` para mudança no app, spec jest da portaria-web para mudança na web. Rodar: API `npx jest -c apps/api/jest.config.cts <arquivos>` em `click-cond-web`; web `npx jest -c apps/portaria-web/jest.config.cts <arquivos>`; app `flutter test --no-pub <arquivo>`. Antes do commit final da tarefa: `npx tsc -p apps/api/tsconfig.app.json --noEmit` (e o da web, se mexeu na web).
- Comentários e mensagens ao usuário em português, no estilo do código vizinho (comentário explica o porquê).
- Commits pequenos, mensagem `fix(<área>): ...` em português, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push, sem merge.
- Não mudar comportamento fora do achado. Não refatorar.

## Fora deste plano (rulings no ledger)
Q2 (assinatura do agente: exige chave fora do GitHub), R4 (troca de e-mail com confirmação: fluxo novo de app), G1/G4 (precisam da bancada Linear), S2/S4/S5/S6 (escrita no ERP real da Superlógica; testar no condomínio de teste antes), D10, K5, I4, T4, V4, R7.

---

### Task 1: Conta órfã não é adotada sem prova de posse (W1, R2, R1, R3)
Achados: W1, R1, R2, R3 (seções "Credenciais de QR…" e "Reuso de conta sem prova de posse").
Regra única a implementar num helper novo em `common/` (ex.: `adocao-conta.util.ts`), usado por todos os pontos de reuso de conta por e-mail/CPF: `moradores/moradores.service.ts` create (≈1189-1213, também via importBulk), `auth/mobile-auth.service.ts` saveMorador (≈5028-5091, morador pela equipe e familiar), `crm/crm-condominios.service.ts` "Vincular síndico" (≈280-344) e o create de morador do CRM (`crm/crm.controller.ts` ≈205-214 com `permitirContaDeOutroCondominio`).
- Conta achada SÓ por CPF (o e-mail do cadastro está vazio ou difere do e-mail da conta) → recusar com 400 e mensagem clara (sem revelar dados da conta). Não adotar por CPF.
- Conta achada por e-mail que já tem senha e NÃO tem vínculo nenhum (helper `usuarioTemVinculoEmOutroCondominio`/vínculos em qualquer condomínio = zero) e não é a conta do próprio solicitante (`idUsuarioDoToken`) → é "conta órfã autocriada": adotar SÓ depois de invalidar a posse anterior: zerar a senha (gerar senha nova aleatória como o `sendCredentials` faz), gravar `senha_alterada_em = now` (derruba tokens, ver `auth/jwt.strategy.ts`), revogar `Credenciais_Acesso` ativas da conta, e enviar a credencial nova ao e-mail da conta pelo mesmo caminho de e-mail já usado no fluxo de credenciais/boas-vindas. Assim só quem controla o e-mail entra.
- `permitirContaDeOutroCondominio` do CRM continua pulando só a recusa de "outro condomínio"; a regra da conta órfã vale também ali.
- Testes: um spec por ponto de entrada provando: (a) conta órfã com senha do "atacante" → depois da adoção o hash da senha mudou, `senha_alterada_em` setado, credenciais revogadas, e-mail enviado; (b) match só por CPF → 400; (c) conta já vinculada neste condomínio / conta do próprio solicitante → comportamento atual preservado.

### Task 2: Revogação não perde a corrida para sync em voo (Q1)
Achado Q1 (seção "Fila de comandos do facial").
Em `facial/facial.service.ts`: `syncMorador`, `syncVisitante`, `syncPessoa`/`pushPessoaToDevices`, e as revogações (`unsyncMorador`, `unsyncVisitante`, `unsyncPessoa`, `unsyncPrestadorServico`, e os ramos de revogação dentro dos syncs) e `consentimentos/consentimentos.service.ts:252-284`.
- Serializar sync e unsync da MESMA pessoa com `comLock` por chave `facial:pessoa:<tipo>:<id>` (o sync inteiro e o unsync inteiro dentro do lock). Escolher duração máxima compatível com o pior caso (vários terminais × 25 s); se o lock não for obtido, marcar `face_sync_status='pending'` para o `tickSyncRetry` refazer (não descartar silenciosamente).
- Dentro do lock, reler a autorização logo antes de enfileirar cada `update/enroll` (se a pessoa deixou de ter direito, não enfileirar e seguir para remoção).
- Na revogação pelo operador (consentimentos), gravar a marca `REVOGADO_PELO_OPERADOR` ANTES do unsync.
- Testes: simular sync lento (foto atrasada) + revogação concorrente e provar que o estado final é removido/revoked e o último comando ao terminal é remove.

### Task 3: Credenciais de QR e passe revogados nos eventos de vida (W2, W3, R6, W4, W5)
Achados W2, W3, W4, W5, R6.
- Revogar credenciais `app` e `wallet_*` do morador (e anular o passe, como `wallet.revogarDoMorador`) quando a unidade é tirada (`moradores.service.ts` update com `id_apartamento: 0`, ≈1590-1631), quando a unidade é apagada (`apartamentos/apartamentos.service.ts` ≈382-409) e quando a senha da conta muda (`senha_alterada_em`: troca/redefinição) — ou, equivalente e mais robusto, fazer `credenciais/credenciais-validacao.service.ts` (≈173-182) e `wallet/wallet.service.ts` (≈313-317) exigirem vínculo atual em `Apartamentos_Users` no condomínio e `cred.criado_em >= users.senha_alterada_em`. Fazer as duas coisas (revogação + checagem na leitura).
- Cancelamento pelo operador ("perdeu o celular", `wallet.service.ts` ≈226-267, 499-516) revoga também a origem `app`.
- W4: `credenciais.service.ts` `lerPassePublico` (≈208-228) devolve 404 quando a visita está negada (`liberado=0` com auth negado), bloqueada ou fora da janela.
- W5: importação de moradores recusa linha sem nenhuma chave (sem e-mail, documento e unidade) (`moradores.service.ts` ≈1088-1100).
- Testes para cada evento.

### Task 4: Terminal desativado, excluído ou com tipo trocado sai limpo (T1, T3, T2)
Achados T1, T2, T3 (seção "Configuração dos terminais").
- `updateDevice` (≈1669-1816) e `removeDevice` (≈1916-1975): antes de desativar, trocar de `facial` para outro tipo ou excluir, enfileirar a remoção de todos os rostos daquele aparelho (reusar `unsyncAllForCondominio` com `deviceIds: [id]`, que hoje filtra `ativo:1, tipo:'facial'` — passar o filtro explicitamente para incluir este aparelho ainda no estado anterior). Se o agente estiver offline e a remoção não puder ser feita, recusar a desativação/exclusão com mensagem explicando (não deixar o aparelho com rostos e fora da varredura).
- T3: `triggerDevice` recusa terminal com `ativo !== 1`.
- T2: ao tirar a área de um terminal, rodar a carga de moradores nele; incluir `id_area_social`, `controle_acesso_facial` e `modelo` na auditoria de mudança.
- Testes.

### Task 5: Portaria remota sem corridas (K1, P4, P3, P1 resto, P8)
Achados K1, P4 (e a variante `assertNegativaConhecida`), P3, P1 resto, P8 (seção "Portaria").
Em `visitantes/visitantes.service.ts` (caminho Pessoas/Visitas e legado):
- P4: autorizar/negar gravam com `updateMany({ where: { id, auth_status: 'pendente' } })`; `count === 0` → 400 "Esta solicitação já foi respondida…". Check-in e liberar do console condicionam a gravação a `auth_status` ≠ 'negado' no `where` (variante de `assertNegativaConhecida`).
- K1: no redirecionamento para outra unidade (≈3741-3772), se a `principal` estava `pendente`, cancelá-la (auth_status para um estado não respondível, ex.: 'cancelado' — usar o que o código já usa para cancelamento, se houver) e chamar `encerrar('visita', principal.id)` no card.
- P3: legado `liberarAcesso` e `solicitarAutorizacao` não zeram `data_entrada` de quem está dentro (mesma trava de `visitaParaNovaPassagem`).
- P1 resto: legado de `listarPessoas` expõe `auth_status='negado'` recente como o caminho novo.
- P8 (web): botões do modal de autorização em `portaria-web/.../visitantes/visitantes-page.component.*` ficam desabilitados por um signal enquanto uma ação está em andamento.
- Testes (incluir a corrida com barreira como a reprodução da varredura).

### Task 6: Reservas de área social (F1, F6, Q3, D2, D6, F5)
Achados F1, F6, Q3, D2, D6, F5.
- Função única `reservaVigenteOuProxima(idArea, idApto, agora)` (aprovada, ainda não encerrada, ordenada por data/hora) que define a janela gravada no terminal; `syncReservaArea` usa SEMPRE essa janela (aprovação, recusa, cancelamento, tick, reconcile). Serializar `syncReservaArea` por `area:<id>:apto:<id>` com `comLock` e recalcular a janela dentro do lock (Q3).
- `reconcileAreaGating`: `hojeBrasilia()` e aguardar (sequencial) os syncs.
- Remoção que falha no terminal da área: persistir como pendente para o tick refazer (ex.: tick de reservas também processa reservas canceladas/recusadas de hoje com remoção pendente, ou marcar o morador 'pending' para o `tickSyncRetry`). Escolher o mais simples que garanta refazer.
- F6: em `runWebhook`, se o device tem `id_area_social` e a área tem `controle_acesso_facial=1`, morador (não funcionário/prestador) só passa com reserva vigente do apto; senão nega com mensagem "Sem reserva para esta área agora".
- D2: `insertAgendamento` (≈838-959) e aprovação (≈1523) conferem conflito dentro de `comLock('area:<id>:<data>')`.
- D6: SQL para `Areas_Sociais_Agendamentos.id_user` anulável com `fk_asa_user ON DELETE SET NULL` + schema.
- F5: exclusão de morador desmatricula também dos terminais de área mesmo sem `face_id` (usar `morador_<id>`).
- Testes.

### Task 7: Guarita (G3, G2, G5, G6, G7)
Achados G2, G3, G5, G6, G7 (seção "Guarita / Linear").
- G3: a reivindicação em `guarita/guarita-agente.service.ts` (≈244-254) inclui `frame_hex` lido no `where`; a operação grava o frame entregue (coluna existente ou nova `frame_entregue`) e a conclusão (`guarita-operacoes.service.ts` ≈889) confirma o frame ENTREGUE, não o relido.
- G2: 0x02 sem o Ler de conferência vira "incerto" (não conflito); na comparação de mesma unidade, ignorar o contador do RF; `desfazer`/troca de tag com gravação entregue enfileiram apagar conferido (regra F2 `gravacaoEntregue`).
- G5: desativar o Guarita com remoções pendentes é recusado; apagar enfileirado em aparelho inativo abre alerta `remocao_pendente`.
- G6: evento só é atribuído a tag em estado gravado/ativo e com unidade do evento igual à do dono; senão "não identificado · unidade X".
- G7: SQL unique (id_device, guarita_tipo, guarita_serial) + schema + tratamento P2002.
- Testes (há `guarita-banco-falso.testutil.ts`).

### Task 8: Superlógica — leitura e cobrança (S1, S3, S7, S8)
Achados S1, S3, S7, S8. Nada escreve no ERP nesta tarefa.
- S1: depois de uma leitura COMPLETA (paginação até o fim, sem truncar) de uma janela, marcar como cancelada localmente (status que as consultas de dívida já excluem, ou novo status 'cancelado' excluído em inadimplência/notificar/lembrete/tela do morador) toda linha `origem='superlogica'` da janela cujo `id_externo` não voltou; tratar como pendente só `fl_status_recb === '0'` (conferir constantes em `superlogica.service.ts`).
- S3: guardar junto da linha digitável o valor/vencimento/URL de origem e raspar de novo (ou zerar) quando mudarem (`superlogica-sync.service.ts` ≈339-347, 379).
- S7: notificar inadimplente usa só faturas vencidas, ordenadas por vencimento, e recusa sem nenhuma vencida (`financeiro.service.ts` ≈1529-1661).
- S8: `formatarData` com partes de Brasília (`superlogica.client.ts` ≈89-93).
- Testes (há `superlogica-sync.spec.ts`).

### Task 9: Contrato app ↔ API (C1, C2, C3, C4, C5, C6, A2, A3)
Achados C1–C6, A2, A3 (seção "App ↔ API").
- C1: rotas `/vagas/*` e `/veiculos/*` do mobile-auth aceitam `id_apartamento` opcional; `resolveMoradorId`/`resolveMoradorApto` filtram o vínculo por `id_apto` quando vier (validando posse) e, sem ele, usam `orderBy: { id: 'asc' }` (determinístico); o app (`controller_vagas.dart`, `controller_veiculos.dart`) manda `Singleton.instance.id_apartamento` (conferir o nome do campo no Singleton).
- C2: `@HttpCode(200)` em `POST inadimplente/notificar` e o app aceita 2xx decidindo por `success`.
- C3: `retirar` do staff aceita 'Esperando' → 'Retirada' (como o do morador), no `updateMany` condicional.
- C4/A3: pushes 'financeiro' e 'autorizacao_visitante' levam `id_condominio`; no toque o app define o condomínio antes de abrir a tela (ou abre a lista sem filtro).
- C5: botão Cadastrar do pré-registro de encomenda com trava `_salvando`.
- C6: `vaga_model.dart` converte datas com `.toLocal()`/`parseDataApi`.
- A2: card Android, NEGAR da portaria recusado com 400/409 fecha o card (`respostaRecusadaFechaCard`).
- Testes Dart e jest.

### Task 10: Banco — FKs, tentativas, duplicatas, consentimentos, índices, DDL (D1, D3, D4, D5, D7, D9)
- D1: SQL recria `fk_vaga_benef` e `fk_vaga_veiculo` com `ON DELETE SET NULL` + `onDelete: SetNull` no schema; no `deleteAccount` (`mobile-auth.service.ts` ≈2425-2470) o `unsyncMorador` passa para DEPOIS do DELETE bem-sucedido (ler as linhas antes, desmatricular depois).
- D3: `validarCodigoRedefinicao` (≈3366-3395) reserva a tentativa atomicamente antes do bcrypt, como `auth/mfa/mfa.service.ts:143-152`, e consome o registro com update condicional a `usado_em: null`.
- D4: SQL com deduplicação segura documentada (só SELECT de verificação + `ALTER TABLE Apartamentos_Users ADD UNIQUE KEY uq_au_apto_user (id_apto, id_user)` com nota de rodar a verificação antes) + `@@unique` no schema + tratamento de P2002 nos creates.
- D5: SQL `Consentimentos.id_user` anulável e `fk_consent_user ON DELETE SET NULL` + schema.
- D7: SQL dos índices de PIN e janelas (lista no relatório) + `@@index` no schema.
- D9: SQL `CREATE TABLE IF NOT EXISTS` de `mfa_challenges` e `user_trusted_devices` idêntico ao schema.
- Testes de D1 (ordem unsync/delete) e D3 (rajada paralela não passa de 5).

### Task 11: Relatórios e exportação (X1, X2, X3, X4)
- X1: `relatorios.service.ts` `generate` registra auditoria `EXPORT` (tipo, formato, filtros, linhas, autor do token, IP do contexto); os exports passam o IP.
- X2: só síndico estrito desliga a máscara na exportação de moradores; finalidade obrigatória; ação `EXPORT`.
- X3: paginação da auditoria com desempate por `id`.
- X4: CSV avisa truncamento (linha final), horário em America/Sao_Paulo; download valida datas com `dataIsoOuErro`.
- Testes.

### Task 12: ATA, ex-morador e unidade duplicada (V1, V2, V3, I3)
- V1: `documentos.remove` recusa documento referenciado por `Assembleias.id_documento_ata` (e a apuração dela); `insert` com `is_ata=1` só pelo `finish`.
- V2: push/feed/listas de comunicados, convocações, enquetes, ATA e ocorrências públicas usam vínculo em `Apartamentos_Users` (não só `Moradores`).
- V3: `saveApto` do app delega a `ApartamentosService.create/update` (com `chaveUnidade`).
- I3: `finish` indexa a ATA no RAG (`ChatIaService.indexarDocumentoPorId`, best-effort).
- Testes.

### Task 13: Portaria-web zoneless (P7 e os 3 casos)
- `encomendas-page.component.ts`: scanner ZXing (≈932-969), erro do scanner (≈938-942; a mensagem precisa ficar visível fora do `@if (isScanning)`), webcam da retirada (≈1078-1082; e `capturePhoto` não grava foto sem stream ativo); `moradores-page.component.ts` Editar (≈372-378, 423). Usar signals ou `markForCheck()` como os modelos citados no relatório.
- Specs zoneless provando que a tela atualiza.

### Task 14: Fila do facial — Control iD e rajada dos ticks (Q4, Q5, Q6)
- Q4: no driver Control iD (`agent/src/drivers/controlid-facial.js`), update/remove resolvem o usuário pelo `registration` (externalId) em cada aparelho, sem usar id interno de outro aparelho.
- Q5: ticks que disparam muitas pessoas usam concorrência limitada por condomínio (há `common/limitar-concorrencia.ts`) e aguardam dentro do lock do `noCluster`.
- Q6: `despacho.js` aborta o `open_door` se o prazo restante acabou antes de executar a chamada da LAN (não abrir depois de a nuvem responder timeout).
- Testes (agente tem harness em `agent/harness`).

### Task 15: Card ao vivo e IA (K2, K3, K4, I1, I2)
- K2: quando `updateFcmToken` migra um token de dono, encerrar `Cards_Ao_Vivo` abertos daquele token.
- K3: destinos do card de delivery filtrados pelo vínculo atual.
- K4: com dono definido no pedido do portão, reabrir card só para o dono.
- I1: card de "lançar conta" mostra o PIX inteiro; trechos de documento entram marcados como dado não confiável no prompt.
- I2: cota diária com incremento atômico condicional.
- Testes.
