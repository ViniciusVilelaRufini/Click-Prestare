# Agente Local — Etapa 1: núcleo em drivers, auto-atualização, serviço e diagnóstico

Data: 2026-09-23 · Status: aprovado pelo usuário (abordagem A + ordem de etapas)

## Contexto

O Agente Local (`click-cond-web/agent/index.js`, ~2460 linhas, arquivo único) faz a ponte
entre a nuvem e os aparelhos da LAN do condomínio (faciais Intelbras/Dahua, Hikvision,
Control iD). Problemas que motivam a etapa:

- Tudo decidido por `if (fabricante === …)`, sem olhar o `tipo` do dispositivo: uma câmera
  LPR Intelbras recebe o ouvinte de eventos de rosto.
- O `.exe` distribuído ficou 3 meses desatualizado (release `agent-v1.0.0`, jun/2026) sem
  que ninguém percebesse: não há atualização automática nem visibilidade de versão.
- O agente roda por tarefa agendada ONSTART, sem reinício se cair.
- Diagnóstico depende de print da janela do agente.

Esta é a etapa 1 de 6 (depois: ciclo inteligente do facial; descoberta na rede; LPR;
antenas UHF; Guarita/Nice/controladoras). **Nenhuma mudança de comportamento visível nos
aparelhos**: o harness (`agent/harness/run.js`, 64 verificações) é o contrato e tem de
passar do começo ao fim.

## Decisões

1. **Código-fonte modular, executável único.** Fonte em `agent/src/**` (CommonJS, só
   módulos nativos do Node — nenhuma dependência npm em runtime). `esbuild` (já no repo,
   0.27) junta tudo em `agent/dist/click-agent.cjs`; o Node SEA embute esse arquivo no
   `.exe`. `build-exe.mjs` faz os dois passos.
2. **Drivers por (tipo, fabricante).** `src/drivers/registro.js` resolve o driver; combinação
   sem driver é registrada ("sem driver para lpr/intelbras") e não recebe ouvinte.
   Contrato do driver (todos os métodos opcionais exceto `id`):
   - `id` (string, ex. `dahua-facial`)
   - `testar(device)` → `{ ok, erro? }`
   - `executar(device, cmd)` → mesmo formato de resultado que o agente já devolve hoje
     (enroll, update, remove, list_users, remove_users, open_door, snapshot, ping,
     set_lighting…)
   - `escutar(device, aoEvento)` → abre o stream de eventos ao vivo; devolve `parar()`
   - `buscarDesde(device, marca)` → `{ eventos, novaMarca }` (replay offline)
   - `acertarRelogio(device)`
3. **Núcleo** (`src/core/`): `nuvem.js` (requisições à API, relógio da nuvem), `estado.js`
   (arquivos de estado ao lado do executável, escrita atômica), `fila-offline.js`
   (store-and-forward já existente), `supervisor.js` (um supervisor por dispositivo:
   inicia/para o driver certo quando a lista de dispositivos muda, reconecta com espera
   crescente, mede saúde), `telemetria.js`, `atualizador.js`.
4. **Comportamento dos drivers existentes preservado.** O código de Dahua/Intelbras,
   Hikvision e Control iD é movido, não reescrito. O replay offline que hoje só existe na
   Intelbras e (parcialmente) na Hikvision passa a ser chamado pelo supervisor para todo
   driver que implementar `buscarDesde`.
5. **Telemetria sem migração de banco.** O agente envia a cada 60 s
   `POST /api/facial/agent/condo/:token/telemetria` com
   `{ versao, so, iniciado_em, dispositivos: [{ id, driver, online, ultimo_evento_em,
   ultimo_erro, eventos_pendentes }] }`. A API guarda a última telemetria em memória no
   `AgentBridgeService` (perder no restart da API é aceitável: volta em 60 s) e expõe
   `GET /api/condominios/:idCondominio/facial/agente/saude` (operador) para o portal. O
   portal (tela Terminais) mostra versão do agente, "atualização disponível" e, por
   aparelho, driver/online/último erro/fila.
6. **Auto-atualização.** A API expõe `GET /api/facial/agent/condo/:token/versao` →
   `{ versao, url, sha256 }`, lido do último release do GitHub (asset `click-agent.exe` e
   `click-agent.exe.sha256`), com cache de 10 min e override por env
   (`AGENT_LATEST_VERSION`, `AGENT_DOWNLOAD_URL`, `AGENT_SHA256`). O agente consulta na
   partida e a cada 6 h; se a versão for maior, baixa para `click-agent.new.exe`, confere o
   SHA-256 (download sem hash correspondente é descartado), grava `atualizacao.json`
   (`{ de, para, tentativas: 0 }`), troca os arquivos (renomeia o exe em uso para
   `click-agent.old.exe` — permitido no Windows — e o novo para `click-agent.exe`) e sai
   com código 0; o laço de serviço reinicia. A versão nova incrementa `tentativas` ao
   subir e apaga `atualizacao.json` após o primeiro poll bem-sucedido. Se `tentativas`
   chegar a 3, ela mesma restaura `click-agent.old.exe` e sai (rollback).
7. **Serviço.** O instalador (o `.bat` gerado pelo portal e `agent/install-windows.bat`)
   grava `run-agent-service.cmd` com laço de reinício (`:loop` → roda o exe com log em
   `agent-service.log` → espera 5 s → `goto loop`) e registra a tarefa ONSTART/SYSTEM
   apontando para ele. Log rotacionado pelo próprio agente ao passar de 5 MB.
8. **Versão.** `src/versao.js` exporta `AGENT_VERSION` (formato `AAAA.MM.DD[.N]`). O build
   grava `dist/click-agent.exe.sha256`. Release: tag `agent-v<versão>` com os dois assets.

## Fora do escopo

Descoberta na rede, carga/conferência de cadastros, checklist de provisionamento, LPR,
antenas e controladoras (etapas 2–6). Senhas cifradas em disco e live view restrito a
localhost entram na etapa 2 (a live view já escuta só em localhost — conferir).

## Testes

- `node --test agent/test` — testes unitários de `src/lib` e `src/core` (sem rede real).
- `node agent/harness/run.js` — regressão ponta a ponta contra aparelhos simulados; deve
  seguir com 64+ PASS. Novos cenários: supervisor não liga ouvinte de rosto em LPR;
  telemetria enviada; atualizador (download com hash errado descartado; troca + rollback).
- API: jest para os endpoints de telemetria/versão/saúde.
