# Plano — Agente Local, Etapa 1

Spec: `click-cond-web/docs/superpowers/specs/2026-09-23-agente-local-etapa1-design.md`
Branch: `feature/agente-drivers` (worktree `C:/tmp/agente-drivers`). Diretório de trabalho
dos comandos abaixo: `C:/tmp/agente-drivers/click-cond-web`.

## Global Constraints

- Runtime do agente: **somente módulos nativos do Node** (http, https, crypto, fs, path,
  url, child_process, readline, node:sea). Nenhuma dependência npm em runtime.
- Fonte CommonJS em `agent/src/**`; bundle `agent/dist/click-agent.cjs` via esbuild
  (`platform: 'node'`, `format: 'cjs'`, `target: 'node20'`). `agent/dist/` é gerado — não
  versionar (adicionar ao `agent/.gitignore`).
- **Harness é o contrato:** `node agent/harness/run.js` tem de terminar com `0 falharam`
  após CADA tarefa (hoje: 64 PASS). O harness passa a rodar o BUNDLE (tarefa 1).
- Testes unitários: `node --test agent/test` (arquivos `agent/test/*.test.js`,
  `node:test` + `node:assert/strict`), sem rede real (servidores locais em porta 0 quando
  preciso).
- Comentários e mensagens em português, no estilo do código atual (explicam o PORQUÊ).
- Estado em disco continua AO LADO do executável (função `configDir()` atual): nomes de
  arquivo existentes (`device-baselines.json`, `events-queue.jsonl`, `.env`) não mudam —
  instalações existentes seguem funcionando após atualizar.
- Nenhuma mudança de protocolo com os aparelhos. Endpoints existentes da API
  (`/api/facial/agent/...`) não mudam de formato.
- Commits pequenos, mensagem em português no padrão `tipo(escopo): descrição`, terminando
  com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- API (NestJS): `npx tsc -p apps/api/tsconfig.app.json --noEmit` limpo e
  `npx jest -c apps/api/jest.config.cts <pasta>` verde para o que tocar. Portal:
  `npx jest -c apps/portaria-web/jest.config.cts` e `npx nx build portaria-web --skip-nx-cache`.

## Task 1: Pipeline de build modular (sem mudar código)

Mover `agent/index.js` para `agent/src/index.js` **sem alterar o conteúdo** e criar o
bundle.

- `agent/build-bundle.mjs`: usa `require('esbuild').buildSync` (resolver o esbuild do
  `click-cond-web/node_modules`) com entry `agent/src/index.js`, saída
  `agent/dist/click-agent.cjs`, `bundle: true`, `platform: 'node'`, `format: 'cjs'`,
  `target: 'node20'`, `legalComments: 'none'`. Exporta/roda a função `bundle()`.
- `agent/build-exe.mjs`: roda o bundle antes; `sea-config.json` passa a apontar `main`
  para `dist/click-agent.cjs`; após gerar o exe, grava `click-agent.exe.sha256` (hex
  minúsculo do SHA-256 do exe) ao lado.
- `agent/harness/run.js`: antes de copiar, roda o bundle e copia
  `dist/click-agent.cjs` para `.tmp-agent/index.js` (o resto do harness não muda).
- Atualizar `package.json` (`scripts.start` → `node dist/click-agent.cjs`,
  `scripts.build` → bundle, `scripts.test` → `node --test test`), `start-agent.cmd`,
  `rebuild-agent.bat` e README do agente onde citarem `index.js`.
- `agent/.gitignore`: `dist/`.
- Criar `agent/test/bundle.test.js`: roda o bundle e confere que o arquivo existe e que
  `node --check` passa.

Aceite: harness 64/64 PASS rodando o bundle; `node --test agent/test` verde;
`node agent/build-exe.mjs` gera exe + `.sha256`.

## Task 2: Extrair utilitários puros para `src/lib`

Mover (sem mudar lógica) funções sem estado de `src/index.js` para módulos:

- `src/lib/digest.js`: `md5`, `buildDigestHeader`, `parseChallengeInto`, `computeDigest`.
- `src/lib/dahua-formato.js`: `formatDahuaTime`, `parseDahuaINI`, `dahuaEpochToISO`,
  `hikIsoComOffset`.
- `src/lib/multipart.js`: `buildMultipart`.
- `src/lib/http.js`: `request`, `lanRequest`, `okFrom`, `parseJson`, `sleep`.
- `src/versao.js`: `module.exports = { AGENT_VERSION: '2026.09.24' }`; `src/index.js`
  passa a importar daqui.

`src/index.js` passa a `require` desses módulos. Testes em `agent/test/lib-*.test.js`
cobrindo: digest (valor conhecido de RFC 2617 exemplo "Mufasa"), parse INI Dahua
(registros `records[0].X=`), `dahuaEpochToISO`, `hikIsoComOffset` (sem "Z", com offset
-03:00), `buildMultipart` (boundary e partes), `request` contra servidor local (GET e
POST JSON, timeout).

Aceite: harness 64/64; testes novos verdes.

## Task 3: Núcleo — estado, fila offline e nuvem

- `src/core/estado.js`: `configDir()` (mesma lógica atual), `lerJson(nome, padrao)`,
  `gravarJsonAtomico(nome, obj)` (grava `nome.tmp` e renomeia), e as funções de
  marca d'água atuais (`loadBaselines`, `setBaseline`, `baselinesPath`) reescritas sobre
  elas mantendo o MESMO arquivo e formato.
- `src/core/fila-offline.js`: `enqueueOfflineEvent`, `flushOfflineEvents`,
  `offlineQueuePath`, contagem `pendentes()`.
- `src/core/nuvem.js`: `cloudRequest`, `registrarSkewDaNuvem`, `agoraDaNuvem`, config
  (`API_URL`, tokens) recebida por `configurar({ apiUrl, ... })` em vez de variáveis
  globais soltas.

Testes: gravação atômica (arquivo final íntegro mesmo com `.tmp` pré-existente);
baselines persistem e recarregam; fila: enfileira N eventos, `flush` com nuvem falsa
(servidor local) envia em ordem e esvazia, e com nuvem fora mantém tudo; `pendentes()`.

Aceite: harness 64/64; testes verdes.

## Task 4: Contrato de driver, registro e driver Dahua/Intelbras facial

- `src/drivers/registro.js`: `resolverDriver(device)` → driver por `(tipo, fabricante)`;
  fabricante normalizado (`intelbras` e `dahua` → família dahua). Mapa inicial:
  `facial/intelbras`, `facial/dahua` → `dahua-facial`. Sem driver → `null`.
- `src/drivers/dahua-facial.js`: move todo o código Dahua (login RPC2, enroll, remove,
  list/remove users, open door, snapshot, lighting, stream de eventos
  `startDahuaEventListener`/`dahuaAttachOnce`/`consumeDahuaEvents`, `syncDeviceOfflineLogs`,
  `dahuaFindAccessRecords`, `dahuaSyncClock`, `advanceBaselineWhileOnline`) expondo o
  contrato da spec (`id`, `testar`, `executar`, `escutar`, `buscarDesde`,
  `acertarRelogio`).
- `executeOnDevice` em `src/index.js` passa a delegar a `resolverDriver(device).executar`
  para Dahua (Hik e Control iD continuam no código antigo até a tarefa 5).

Testes: `registro` (combinações, fabricante normalizado, desconhecido → null).

Aceite: harness 64/64.

## Task 5: Drivers Hikvision e Control iD (facial)

- `src/drivers/hikvision-facial.js` e `src/drivers/controlid-facial.js`: movem o código
  existente de cada marca para o contrato. Registro: `facial/hikvision`,
  `facial/control_id`.
- `buscarDesde`:
  - Hikvision: usar a busca de eventos já existente no replay (`hik: replay manda janela
    de tempo` no harness) exposta pelo contrato.
  - Control iD: buscar `access_logs` com id maior que a marca (reusar
    `controlIdFetchNewLogs`); nova marca = maior id retornado.
- Remover de `src/index.js` todo `if (device.fabricante === ...)` restante: o laço usa só o
  registro.

Testes: harness (acrescentar em `harness/mock-device.js`/`run.js` um cenário de replay
offline para Control iD: log criado com o agente parado aparece como backlog ao voltar,
sem duplicar o que já foi enviado).

Aceite: harness 64+ (com o novo cenário) PASS.

## Task 6: Supervisor por dispositivo

`src/core/supervisor.js`: `class Supervisor { atualizar(devices) }` — para cada device
ativo cria/mantém um `SupervisorDispositivo` que: resolve o driver; se `null`, registra
uma vez `"<nome>: sem driver para <tipo>/<fabricante>"` e não faz nada; senão inicia
`escutar` (uma vez), reconecta com espera crescente (1 s, 2 s, 4 s … teto 60 s) quando o
stream cai, chama `buscarDesde` ao reconectar, `acertarRelogio` ao conectar e a cada 1 h,
e mantém `saude()` → `{ id, driver, online, ultimo_evento_em, ultimo_erro }`. Device
removido da lista → `parar()`. `src/index.js` usa o Supervisor no laço de poll.

Testes unitários com driver falso: não liga nada para tipo sem driver (ex.
`lpr/intelbras`); reconecta com backoff após queda; para quando o device sai da lista;
`saude()` reflete último evento e último erro. Harness: acrescentar cenário com um
dispositivo `tipo: 'lpr', fabricante: 'intelbras'` na lista da nuvem falsa e verificar
que o mock Dahua NÃO recebe assinatura de eventos para ele.

Aceite: harness verde; testes verdes.

## Task 7: Telemetria (agente + API + portal)

- Agente: `src/core/telemetria.js` monta o payload da spec (versão, `so` =
  `os.platform()+' '+os.release()`, `iniciado_em`, dispositivos do `Supervisor.saude()`,
  `eventos_pendentes` da fila) e envia a cada 60 s para
  `POST /api/facial/agent/condo/:token/telemetria` (falha de envio só loga).
- API: rota `@Public() @Post('condo/:token/telemetria')` no `AgentController` (resolve
  condomínio pelo token como as outras rotas `condo/`), guarda no `AgentBridgeService`
  (`Map<idCondominio, { recebido_em, ...payload }>`); rota
  `GET condominios/:idCondominio/facial/agente/saude` (controller do facial do console,
  `assertOperador`) devolve a última telemetria + `versao_disponivel` (da tarefa 8, pode
  começar `null`). Jest: token inválido → 404/403 como as outras; operador lê; morador
  recusado.
- Portal (`apps/portaria-web/src/app/terminais-faciais`): no card do agente, mostrar
  versão, "Atualização disponível" quando `versao_disponivel > versao`, e por aparelho
  (casando por id) driver, online, último erro e eventos pendentes. Teste do componente
  para o mapeamento.
- Harness: nuvem falsa aceita a rota e o cenário confere que chegou telemetria com versão
  e dispositivos.

Aceite: tudo verde.

## Task 8: Auto-atualização

- API: `GET facial/agent/condo/:token/versao` (@Public, token válido) →
  `{ versao, url, sha256 }`. Fonte: envs `AGENT_LATEST_VERSION`, `AGENT_DOWNLOAD_URL`,
  `AGENT_SHA256` se todas presentes; senão GitHub API
  `https://api.github.com/repos/Viniciusvile/Click-Prestare/releases/latest` (tag
  `agent-v<versao>`, assets `click-agent.exe` e `click-agent.exe.sha256` — baixar o texto
  do `.sha256`), cache 10 min; falha → `{ versao: null }`. Jest com fetch mockado.
  A rota de saúde (tarefa 7) passa a preencher `versao_disponivel`.
- Agente: `src/core/atualizador.js`:
  - `compararVersoes(a, b)` (segmentos numéricos de `AAAA.MM.DD[.N]`).
  - `verificar()` na partida (após primeiro poll ok) e a cada 6 h; só age se rodando como
    exe SEA (`node:sea` `isSea()`), senão só loga.
  - Baixa para `click-agent.new.exe`, confere SHA-256; divergente → apaga e loga.
  - Grava `atualizacao.json` `{ de, para, tentativas: 0 }`, renomeia o exe atual para
  `click-agent.old.exe`, o novo para `click-agent.exe`, sai com código 0.
  - Na partida: se `atualizacao.json` existe e `para === AGENT_VERSION`, incrementa
    `tentativas`; se `tentativas >= 3`, restaura (`click-agent.exe` → `click-agent.bad.exe`,
    `click-agent.old.exe` → `click-agent.exe`), apaga o json e sai 0. Após o primeiro poll
    bem-sucedido, apaga o json.
  - Testes unitários com diretório temporário e servidor local: versões; hash errado
    descartado; troca de arquivos; rollback após 3 tentativas; nada acontece fora de SEA.
- `build-exe.mjs` já grava o `.sha256` (tarefa 1). Documentar no README do agente o
  comando de release: `gh release create agent-v<versao> dist/../click-agent.exe
  click-agent.exe.sha256 --latest`.

## Task 9: Serviço com reinício e log rotativo

- `agent/install-windows.bat` e o `.bat` gerado pelo portal (`facial.service.ts`,
  função que monta o instalador): `run-agent-service.cmd` passa a ter laço
  `:loop` → `"%~dp0click-agent.exe" >> "%~dp0agent-service.log" 2>&1` →
  `timeout /t 5 /nobreak >nul` → `goto loop`; tarefa ONSTART/SYSTEM aponta para o cmd;
  o instalador do portal também passa a gerar esse cmd (hoje aponta direto para o exe).
  Jest do facial.service cobrindo o conteúdo gerado (laço, tarefa apontando para o cmd).
- Agente: ao iniciar, se `agent-service.log` > 5 MB, renomeia para
  `agent-service.1.log` (sobrescrevendo o anterior). Teste unitário.

Aceite: jest da API verde; testes do agente verdes; harness verde.
