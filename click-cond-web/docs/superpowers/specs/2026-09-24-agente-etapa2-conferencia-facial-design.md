# Etapa 2 (enxuta) — Conferência automática dos faciais

Data: 2026-09-24 · Status: desenho aprovado pelo usuário em conversa; **implementação adiada**
(retomar a partir daqui: revisar este documento → `superpowers:writing-plans` → implementação).

## Objetivo

Trocou, resetou ou religou um facial: ele volta sozinho com todo mundo que as Regras de Acesso
permitem, sem ninguém clicar em nada. Se um rosto sumir do aparelho por qualquer motivo, a
nuvem percebe e regrava. O portal mostra se cada facial está completo.

Escopo aprovado: itens 1, 2 e 5 da proposta original. **Fora do escopo** (decidido):
- Horário/sentido da regra imposto no próprio aparelho: hoje só auditado na nuvem; entra quando
  algum cliente usar regra por horário.
- Senha dos aparelhos cifrada no PC da portaria: desnecessário, o agente não grava essas senhas
  em disco (só o `AGENT_TOKEN` no `.env`).
- "Público do facial" (só moradores / só visitantes): já existe nas **Regras de Acesso**
  (`Regras_Acesso` + `Regras_Dispositivos`), aplicado no cadastro por
  `categoriasPermitidasNoDispositivo` em `facial.service.ts`.

## Decisão de arquitetura

**A conferência roda na nuvem (API NestJS), não no agente.** A nuvem já sabe listar quem está
no aparelho (`FacialDeviceClient.listUserIds`, via comando `list_users` do agente) e já concentra
a regra de autorização (validade/dias da semana do visitante, menor com termo, Regras de Acesso,
área de lazer com reserva). Duplicar isso no agente faria as duas lógicas divergirem.

Consequência: **o agente não muda.** Deploy = API (EB via push master) + portal (Amplify via
main). Nenhum executável novo, nenhuma atualização nos condomínios.

## Estado atual (ponto de partida)

- `FacialService.tickFantasmas()` (`apps/api/src/app/facial/facial.service.ts`, ~linha 3422):
  roda 10 min após o boot e de hora em hora; para cada facial ativo de fabricante com listagem
  (`FABRICANTES_COM_LISTAGEM`), lista os ids no aparelho e remove os que não existem em
  moradores / visitantes / prestadores_servico / pessoas. **Quando o aparelho volta vazio, faz
  `continue`**: é exatamente o caso do aparelho resetado, que hoje é ignorado.
- Envio por pessoa, já aceitando `{ deviceIds }`: `syncMorador`, `syncVisitante`,
  `syncPrestadorServico`, `syncPessoa`. Cada uma reavalia a autorização e grava ou remove.
- Recarga em massa: `syncAllForCondominio(id, { onlyPending, categorias, deviceIds })`, com trava
  `bulkSyncEmAndamento` por condomínio.
- Status por pessoa (não por aparelho): coluna `face_sync_status` ('synced', 'pending', 'error',
  …) nas quatro tabelas de pessoa.
- Transição online/offline do facial: `reportDeviceStatuses` → `handleDeviceStatusTransition`.
- Portal: `apps/portaria-web/src/app/terminais-faciais/` (página, serviço `TerminaisFaciaisApi`,
  spec de layout com mocks de `agentSaude`/`health`).

## Desenho

### 1. Aparelho zerado ou trocado → recarga só daquele facial

Na conferência, se `idsNoAparelho.length === 0` **e** existe ao menos uma pessoa esperada
naquele facial (ver "esperadas" abaixo), disparar
`syncAllForCondominio(idCondominio, { onlyPending: false, deviceIds: [device.id] })` e registrar
no AuditLog (`acao: 'FACIAL_RECARGA_AUTOMATICA'`, `modulo: 'facial-health'`). Se a trava do
condomínio estiver ocupada (`alreadyRunning`), a próxima conferência tenta de novo.

Gatilho extra além da hora cheia: em `handleDeviceStatusTransition`, na transição
**offline → online** de um facial, agendar a conferência **só daquele facial** para ~60 s depois
(debounce por device id: várias transições seguidas geram uma conferência só).

### 2. Conferência completa (remove quem sobra, regrava quem falta)

Extrair de `tickFantasmas` uma função `conferirDispositivo(device)` usada pelo tick horário, pelo
gatilho de reconexão e pelo botão do portal. Ela:

1. Lista os ids no aparelho (`listUserIds`).
2. **Sobras:** mesma regra de hoje (id no aparelho que não existe no banco → `removeUsers` +
   AuditLog `FANTASMAS_REMOVIDOS`). Sem mudança de comportamento.
3. **Esperadas:** pessoas do condomínio com `face_id` não nulo **e** `face_sync_status = 'synced'`
   **e** categoria permitida no facial (`categoriasPermitidasNoDispositivo` + `categoriaAutorizada`).
   Para visitante/prestador, só quem ainda está autorizado pelo mesmo filtro que
   `syncAllForCondominio` usa (sem `data_saida`, ou com `face_id` presente).
4. **Faltando** = esperadas cujo `face_id` não está no aparelho. Para cada uma, chamar a função
   de envio da sua fonte com `{ deviceIds: [device.id] }`, **em sequência**, até
   `LIMITE_REGRAVACOES_POR_RODADA` (proposta: 100). O resto fica para a próxima rodada.
5. **Exclusões:**
   - `face_sync_status = 'error'` (foto recusada pelo aparelho) não entra em "esperadas", para não
     tentar sem fim de hora em hora; continua visível como erro na lista de pessoas do portal.
   - Facial de área de lazer com reserva (`id_area_social` com `controle_acesso_facial = 1`):
     **não calcula faltantes** (lá só fica quem reservou no horário; quem manda é
     `reconcileAreaGating`/`syncReservaArea`). A remoção de sobras continua valendo.
6. Guarda o resultado em memória (mesmo padrão efêmero da telemetria da etapa 1):
   `Map<deviceId, { em, noAparelho, esperadas, faltando, sobrando, regravadas, recargaCompleta,
   erro? }>`.

### 5. Portal — tela Terminais

- Endpoint operador `GET /api/condominios/:idCondominio/facial/conferencia` → lista do resultado
  acima para os faciais do condomínio (isolado por condomínio como os outros endpoints de
  saúde).
- Endpoint operador `POST /api/condominios/:idCondominio/facial/devices/:id/recarregar` →
  valida que o device é do condomínio, chama `syncAllForCondominio(..., { onlyPending: false,
  deviceIds: [id] })` e, ao terminar, `conferirDispositivo(device)`. Responde já (segundo plano).
- Em cada card de facial: "No aparelho: 58 · esperadas: 60 · faltando: 2 · sobrando: 0",
  "Última conferência: há 12 min" e botão **"Refazer carga"** (desabilitado enquanto roda; mostra
  "Recarga em andamento" se a trava do condomínio estiver ocupada).
- Sem conferência ainda (API reiniciou): mostrar "Conferência pendente" em vez de zeros.

## Tratamento de erro

- Falha ao listar (agente offline, aparelho fora do ar): registra `erro` no resultado daquele
  facial e segue para o próximo; nada é removido nem regravado com base em lista incompleta.
- Falha ao regravar uma pessoa: loga e segue; a função de envio já marca o status da pessoa.
- Aparelho vazio **e** nenhuma pessoa esperada: não faz nada (condomínio novo, sem cadastros).

## Testes

API (jest, junto de `tick-fantasmas.spec.ts`):
- aparelho vazio com esperadas → dispara recarga só daquele facial;
- aparelho vazio sem esperadas → não faz nada;
- pessoa synced ausente → regravada só naquele facial (`deviceIds: [id]`);
- pessoa com `face_sync_status = 'error'` → não regravada;
- categoria negada pela Regra de Acesso → não conta como esperada;
- facial de área com reserva → não calcula faltantes, mas remove sobras;
- limite por rodada respeitado;
- falha no `listUserIds` → nada removido/regravado, erro no resultado;
- transição offline→online agenda uma conferência (debounce);
- endpoints: isolamento por condomínio (device de outro condomínio → 404/403).

Portal (jest): card mostra os números, "Conferência pendente" sem dados, botão chama o endpoint e
fica desabilitado durante a recarga.

## Estimativa

Meio dia a 1 dia, incluindo revisão e publicação (API + portal; agente sem mudança).
