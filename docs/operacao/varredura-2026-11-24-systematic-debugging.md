# Varredura systematic-debugging — 24/11/2026

**Base analisada:** `origin/main` 954e2fd8 (o que está em produção). Nada foi corrigido; é só investigação com prova.
**Escopo:** app, sistema web (API + portaria-web), banco de dados e acesso físico. CRM fora, com uma ressalva no financeiro (S2 e S4 moram na pasta do CRM, mas são a integração com a Superlógica).
**Base verde antes de começar:** 4.099 testes da API e 788 do app passam; typecheck da API e da web passa; `prisma validate` ok. Os achados abaixo são de lógica que os testes não exercitam.

> **Correção de base no meio da varredura.** A árvore de trabalho (`feat/card-ao-vivo-portaria`) está 538 commits ATRÁS do `origin/main`. A primeira meia hora de leitura foi em código antigo; tudo foi reconferido no main (worktree só de leitura). O que já estava corrigido no main foi descartado e está listado no fim.

Reconferidos pessoalmente no main, além da prova dos agentes: W1, R2, Q1, Q2, G3, S1, C1, C2, K1, T1, V1, X1, X2, P4, D1, D2, D3, F1, F6, F5, A2, A3 e o código do caso Editar morador.

Legenda: **CONFIRMADO** = provado lendo o caminho inteiro e/ou rodando script ou spec descartável. **PLAUSÍVEL** = o código mostra o defeito, mas o efeito depende de algo que não deu para ver daqui (flag no EB, hardware, dado real). Linhas são do main.

## Prioridades

| # | Achado | Gravidade | Veredito |
|---|---|---|---|
| W1 | Estranho cria conta no cadastro público com o e-mail do morador; a importação liga a unidade a essa conta e ele emite o QR do portão | **crítico** | CONFIRMADO |
| R2 | App: cadastro de morador/familiar adota conta achada por e-mail OU CPF; CPF do signup público não é verificado | **crítico** | CONFIRMADO |
| R1 | CRM "Vincular síndico" adota a conta pré-criada pelo signup: estranho vira síndico do cliente (pasta do CRM, mas é a identidade do cliente) | **crítico** | CONFIRMADO |
| Q1 | Facial: sync em voo vence a revogação; o rosto revogado volta ao terminal e o banco diz "synced" | **crítico** | CONFIRMADO (código + simulação) |
| Q2 | Agente: auto-atualização confere o SHA-256 que vem do mesmo release do GitHub; sem assinatura | **crítico** se uma credencial do GitHub vazar | CONFIRMADO |
| G1 | Guarita: remoção dada como feita antes de atualizar os receptores (comando 29) | crítico se o hardware exigir | PLAUSÍVEL (bancada) |
| K1 | Portaria remota: redirecionar o pedido para outra unidade deixa o pedido e o card da unidade original abertos e autorizáveis (libera o rosto pela unidade errada) | alto | CONFIRMADO (caminho Pessoas/Visitas) |
| G3 | Guarita: edição durante a entrega do comando grava uma unidade na central e outra no Prestare; na saída o controle fica ativo | alto | CONFIRMADO |
| G2 | Guarita: falso "conflito" no próprio cadastro; o único botão apaga no Prestare e deixa o controle na central | alto | CONFIRMADO |
| W2 | Ex-morador (unidade tirada ou apagada) segue abrindo com o QR do app e o passe da carteira | alto | CONFIRMADO |
| W3 | "Perdeu o celular": cancelar anula só o passe da carteira; o QR do app continua | alto | CONFIRMADO |
| T1 | Terminal desativado, excluído ou com tipo trocado fica com todos os rostos e fora de toda revogação | alto | CONFIRMADO no código |
| Q3 | Facial: recusar/cancelar reserva logo após aprovar deixa o rosto com a janela recusada; remoção que falha nunca é refeita | alto | CONFIRMADO |
| Q4 | Control iD: o face_id é o id interno de um aparelho só e é usado em todos (troca rosto entre pessoas com 2+ Control iD) | alto | CONFIRMADO no código |
| F6 | Área social "só entra quem reservou" vale só para o rosto; tag e QR passam sem reserva | médio-alto | CONFIRMADO no código |
| P3 | Portaria: "Liberar Catraca" apaga a entrada de quem já está dentro | alto se `PESSOAS_MIGRATION_ENABLED` desligada | CONFIRMADO no código |
| R4 | Troca do e-mail da própria conta sem confirmar o novo (permite tomar e-mail e travar a recuperação da vítima) | alto | CONFIRMADO |
| G4 | Guarita: editar controle RF grava o contador antigo do rolling code | alto | código CONFIRMADO, efeito PLAUSÍVEL (bancada) |
| S1 | Superlógica: cobrança cancelada ou renegociada no ERP fica "pendente" para sempre no Prestare | alto | CONFIRMADO |
| S3 | Superlógica: linha digitável congela; ERP muda valor/vencimento e a linha fica velha | alto | CONFIRMADO |
| S2 | Superlógica: "Reenviar moradores" duplica no ERP real quem já está lá só pelo nome | alto | CONFIRMADO |
| S4 | Superlógica: trocar o condomínio vinculado no ERP deixa cobranças do outro prédio como pendentes eternas | alto | CONFIRMADO |
| C1 | App: vagas e veículos ignoram a unidade aberta (dono de 2 unidades grava na errada) | alto | CONFIRMADO |
| D1 | Banco: FKs das vagas travam remoção de morador, exclusão de conta (Play Store) e de veículo; o rosto sai antes do DELETE que falha | alto | CONFIRMADO (falta `SHOW CREATE TABLE Vagas`) |
| X1 | Relatórios: download (visitantes com documento inteiro, encomendas, ocorrências) não deixa rastro na auditoria | alto (LGPD) | CONFIRMADO |
| D2 | Banco: reserva de área sem trava → duas reservas/aprovações no mesmo horário | alto | CONFIRMADO |
| V1 | Documentos: ATA de assembleia finalizada pode ser apagada ou falsificada por qualquer síndico/funcionário | médio-alto | CONFIRMADO |
| P4 | Portaria: autorizar × negar simultâneos, a última gravação vence (pode liberar negado) | médio | CONFIRMADO |
| F1 | Terminal da área: uma janela por pessoa; a última reserva sincronizada vence | médio | CONFIRMADO |

(Os demais achados estão nas seções por área.)

## Acesso físico

### F1 — Terminal da área social guarda uma janela por pessoa e a última reserva sincronizada vence (médio, CONFIRMADO)
- `apps/api/src/app/facial/facial.service.ts:2787-2789` grava a janela da própria reserva; o agente faz remove+insert (`agent/src/drivers/dahua-facial.js`).
- Gatilho 1: o tick (a cada 10 min, `2861-2895`) sincroniza todas as reservas de hoje não encerradas, sem `orderBy`. Apto com duas reservas na mesma área no mesmo dia (quadra 10h–12h e 19h–21h): uma delas fica negada, ciclo após ciclo.
- Gatilho 2: aprovar ou criar outra reserva do apto durante uma em andamento troca a janela até o próximo tick.
- Gatilho 3: `reconcileAreaGating` (`1850`) usa "hoje" em UTC e dispara `syncReservaArea` sem `await` para todas as reservas futuras. Depois das 21h, quem está na área é removido.
- Direção: uma função única "reserva aprovada vigente ou próxima do apto nesta área" chamada por aprovação, tick e reconcile; `hojeBrasilia()` no reconcile.

### F6 — "Só entra quem reservou" vale só para o rosto (médio-alto, CONFIRMADO no código)
- O gating é feito só pela matrícula do rosto. `runWebhook` (`facial.service.ts:5457` em diante) não consulta `id_area_social` nem reserva.
- QR dinâmico: `credenciais/credenciais-validacao.service.ts:173-182` resolve o morador; o webhook (`5620-5629`) segue para regras do terminal (`6429-6473`), anti-passback e `registrarEvento` (`6612`) e libera.
- Efeito depende de a área ter terminal que lê QR/tag (o cadastro de dispositivo não restringe o tipo).
- Direção: na decisão do webhook, device com área sob controle por reserva exige reserva aprovada vigente do apto para morador.

### F5 — Morador só matriculado em terminal de área não é desmatriculado ao ser excluído (baixo)
- `moradores/moradores.service.ts:1787` e `auth/mobile-auth.service.ts:5311` só chamam `unsyncMorador` com `face_id`; `syncReservaArea` não grava `face_id`. Limitado pela `validTo` da reserva e pelo `tickFantasmas`.

### Guarita / Linear (scripts de prova p1–p4 no scratchpad)
- **G1 (crítico se o hardware exigir, PLAUSÍVEL):** remoção concluída no 0x00 do comando 67/4, antes do 29; falha do 29 não é retentada (`guarita/guarita-operacoes.service.ts:929-967`; `agent/src/drivers/linear-guarita.js:895-912`). O cadastro só vale depois do 29; a remoção não.
- **G2 (alto, CONFIRMADO):** 0x02 com o Ler de conferência falhando, ou RF com contador andado na mesma unidade, vira "conflito" (`agent/src/drivers/linear/operacoes.js:281-293, 378-395`; `guarita-operacoes.service.ts:873-877`). Tag em conflito não bloqueia nem edita, a importação pula, e "Desfazer vínculo" (`guarita-operacoes.service.ts:490-507`; `guarita-captura.service.ts:182, 206-209`) apaga só no Prestare → controle órfão que nada remove depois.
- **G3 (alto, CONFIRMADO):** a reivindicação da fila não confere `frame_hex` (`guarita/guarita-agente.service.ts:244-254`); o agente recebe o frame lido antes (`186-197, 256`) e a conclusão confirma o relido do banco (`guarita-operacoes.service.ts:889`), que a edição pode ter trocado (`213-224`).
- **G4 (alto; código CONFIRMADO, efeito PLAUSÍVEL):** edição/regravação de RF manda o contador antigo (`guarita/guarita-frame.util.ts:258-264, 283-294`; `guarita-operacoes.service.ts:706`) → controle para de abrir, alerta falso de clonagem, replay de códigos antigos.
- **G5 (médio):** Guarita desativado no Prestare congela as remoções sem alerta (`guarita-agente.service.ts:160-165`; `guarita-operacoes.service.ts:516-586`), e a mensagem de exclusão sugere desativar (`facial/facial.service.ts:1402-1405`).
- **G6 (médio):** passagem atribuída ao dono registrado mesmo com a tag em conflito/ausente/removendo, sem comparar a unidade do evento (`guarita-eventos.service.ts:165-175, 203-205`).
- **G7 (baixo):** sem unique (id_device, guarita_tipo, guarita_serial) → corrida cria duas tags para o mesmo controle (`guarita-captura.service.ts:200-233`).
- **Só a bancada confirma:** 67/4 sem o 29; bytes 5-6 do RF; tamanho da resposta 67/3 "não encontrado"; nibble baixo do byte 1 em TA/TP (se divergir, o apagar vira "já não estava" com o controle lá: crítico); ordem BCD do comando 12; Wiegand; layouts 42/46/90; o 29 pode levar até 180 s e "Abrir portão" desiste em 10 s.

### Fila de comandos do facial e agente local (scripts com o despachante real em scratchpad/fila-facial)
O padrão do G3 (conteúdo trocado na fila) **não** se repete: `comando` é imutável, a entrega é única e o resultado atrasado não grava estado. Os problemas estão um nível acima.
- **Q1 (crítico, CONFIRMADO):** sync e revogação da mesma pessoa não são serializados. O sync lê a autorização, faz E/S lenta (foto do S3, sharp, terminal mudo segura 25 s por `enqueue`) e só então manda `update`; no Dahua, `update` é `dahuaEnroll`, que remove e recria a pessoa (`agent/src/drivers/dahua-facial.js:153-155`). Se a revogação (bloqueio, saída, biometria revogada) entra no meio, o terminal recebe remove e depois update: o rosto volta, e a gravação final sem condição (`facial.service.ts:2583-2591`; `3192-3200`; `3656-3664`) grava "synced" por cima de "revoked", apagando a marca `REVOGADO_PELO_OPERADOR`. O `tickFantasmas` não corrige porque o `face_id` existe no banco. Simulação: "ROSTO PRESENTE". Direção: serializar sync/unsync por pessoa (lock ou versão) e gravar com update condicional à versão lida.
- **Q2 (crítico se uma credencial do GitHub vazar, CONFIRMADO):** a API lê o `.sha256` do mesmo release que o `.exe` (`apps/api/src/app/facial/agent-version.service.ts:128-141`) e o agente roda o binário como SYSTEM. O hash protege contra corrupção, não contra quem publica um release. A origem está bem travada (allowlist, HTTPS, normalização de `..`). Direção: assinatura destacada (Ed25519) com chave pública embutida no agente e chave privada fora do GitHub.
- **Q3 (alto, CONFIRMADO):** aprovar e logo recusar a reserva roda dois `syncReservaArea` em paralelo; o remove não baixa foto e ultrapassa o enroll (`facial.service.ts:2748-2853`; `areas-sociais.service.ts:1561-1565`). Falha de remoção só é logada e o cancelamento apaga a linha que permitiria refazer; nenhum tick cobre (o de reservas só olha 'aprovado'). Complementa o F1.
- **Q4 (alto, CONFIRMADO no código):** no Control iD o `face_id` é o id interno do primeiro aparelho (`agent/src/drivers/controlid-facial.js:119-160`) e é usado como `update` nos outros, onde é outra pessoa: nome e foto trocados. Misturado com Dahua, a pessoa nunca entra no Control iD. Falta saber se há cliente com 2+ Control iD.
- **Q5 (médio, CONFIRMADO):** os ticks disparam todas as pessoas em paralelo (`facial.service.ts:4398-4417, 4511-4515`); o agente executa um por vez e descarta o que passa do ttl (~21 s) (`agent/src/core/despacho.js`). Simulação: 40 cadastros de 1,5 s → 25 descartados. Remoções de prestador fora do dia também expiram e a pessoa abre até o retry de 30 min.
- **Q6 (baixo, PLAUSÍVEL):** `open_door` pode abrir depois que a nuvem já respondeu "não respondeu"; o novo clique abre de novo (`despacho.js:112-117`; `agent-bridge.service.ts:360-372`).


### Credenciais de QR e passe da carteira (scripts em scratchpad/novos)
- **W1 (crítico, CONFIRMADO):** sequestro antecipado de conta. `POST /sindico/signup` é `@Public` (`auth/mobile-auth.controller.ts:35-42`) e cria `Users` com `login = email` e a senha de quem chamou, sem provar a posse do e-mail (`auth/mobile-auth.service.ts:367-448`). No cadastro ou importação do morador, `create()` acha a conta pelo e-mail (`moradores/moradores.service.ts:1189-1213`) e, como ela não tem vínculo em outro condomínio, liga a unidade a ela sem mexer em login e senha. O atacante entra como morador, chama `POST /credenciais/minha`, recebe o segredo do QR e ainda emite o passe da carteira. O mesmo vetor já foi fechado para funcionário (`auth/tenant-access.service.ts:135-140`). Direção: não ligar cadastro a conta existente sem prova de posse (convite ou código enviado ao e-mail), ou recusar conta sem vínculo criada pelo signup.
- **W2 (alto, CONFIRMADO):** nenhum evento de desvínculo (tirar a unidade, apagar a unidade) revoga `Credenciais_Acesso` (`moradores.service.ts:1590-1631`; `apartamentos/apartamentos.service.ts:382-409`). A validação e a Wallet exigem só a linha de `Moradores` (`credenciais/credenciais-validacao.service.ts:173-182`; `wallet/wallet.service.ts:313-317`), então o ex-morador abre com o QR guardado e recebe todo dia um passe novo. O Guarita remove as tags no mesmo evento.
- **W3 (alto, CONFIRMADO):** o cancelamento pela portaria ("perdeu o celular") anula só o passe da carteira (`wallet.service.ts:226-267, 499-516`). A credencial `app` não tem validade nem depende de `senha_alterada_em`: o aparelho perdido gera o P1 offline e o leitor aceita; com o JWT de 365 dias, ainda emite passe novo.
- **W4 (baixo):** a página pública do link do visitante continua mostrando código novo depois da negação ou do fim da janela (`credenciais/credenciais.service.ts:156-168, 208-228`). O leitor nega.
- **W5 (baixo):** reenviar a planilha duplica morador sem e-mail, documento e unidade (`OR: []`, `moradores.service.ts:1088-1100`).

### Reuso de conta sem prova de posse (o padrão do W1 em todo o sistema)
A única rota pública que cria `Users` é `/sindico/signup`: grava e-mail **e CPF** sem verificar e devolve token de síndico de 365 dias sem MFA (`auth/mobile-auth.service.ts:405-474`). O segundo jeito de "tomar" um e-mail é trocar o e-mail da própria conta (R4).
- **R1 (crítico, CONFIRMADO; pasta do CRM):** "Vincular síndico" acha a conta por e-mail/login e liga `is_sindico`, `Sindicos` e `Sindicos_Condominios` a ela, sem prova de posse (`crm/crm-condominios.service.ts:280-344`); o próprio CRM manda o operador para esse caminho quando o e-mail já existe (`:131-140`; `crm/crm.service.ts:241-252`). O token antigo do signup passa a valer no console via `selecionar-condominio`, sem MFA. Depois o atacante troca o e-mail da conta (R4) e os códigos de MFA passam a ir para ele.
- **R2 (crítico, CONFIRMADO):** `saveMorador` (morador pela equipe e familiar pelo proprietário no app) busca conta com `OR: [{email}, {cpf}]` (`auth/mobile-auth.service.ts:5029-5036`); o bloqueio de "CPF de uma pessoa, e-mail de outra" só age com os dois e-mails presentes (`5051`); sem vínculo em outro condomínio, adota a conta e mantém a senha (`5059-5091`, `5147-5163`). Atacante com o CPF de um futuro familiar (menor sem e-mail cai sempre na busca por CPF) entra no app com o próprio e-mail e ganha unidade, QR do portão e portaria remota. A vítima não é avisada.
- **R3 (crítico, CONFIRMADO; pasta do CRM):** "criar morador" do CRM passa `permitirContaDeOutroCondominio: true` (`crm/crm.controller.ts:205-214`), que pula a única barreira do W1 (`moradores.service.ts:1197`).
- **R4 (alto, CONFIRMADO):** `updateSindico` e a autoedição do morador trocam `email`/`login` só com a senha atual, sem código no e-mail novo nem aviso ao antigo (`mobile-auth.service.ts:651-719`, `4840-4912`). Toma e-mails livres e, depois de um sequestro, faz o "Esqueci a senha" da vítima não achar a conta (`3256-3275`).
- **R5 (alto, CONFIRMADO, depende de W1/R2):** o cadastro de porteiro aceita conta com qualquer vínculo no condomínio, inclusive o de morador fabricado (`mobile-auth.service.ts:4205-4215`; o comentário em `4185-4187` admite), e `sincronizarUsuarioMobile` cria `Funcionarios` com todas as permissões mantendo a senha (`3949-4010`). A regra correta já existe em `prestadores/prestadores.service.ts:303-316` (só conta que já é da equipe).
- **R6 (médio):** a redefinição de senha da vítima derruba os tokens (`auth/jwt.strategy.ts:84-86`), mas não revoga o segredo do QR (`credenciais/credenciais-validacao.service.ts:151-180`; ver W3), nem a foto do facial.
- **R7 (baixo):** signup ocupa e-mail e CPF únicos (trava o cadastro legítimo) e serve de oráculo de contas (10/h por IP).
- Já protegidos: atalho por e-mail para funcionário (`auth/tenant-access.service.ts:135-140`), `loginFuncionario`, prestador com acesso, `link-user`, edição por terceiro, `importBulk` sem data de nascimento, redefinição de senha de funcionário.
- Direção única: nenhuma ligação de unidade, papel ou condomínio a conta existente achada por e-mail/CPF sem aceite do dono (convite ou código no e-mail), como o tenant-access já faz; signup confirma o e-mail antes de emitir token; troca de e-mail confirma o novo.


### Configuração dos terminais
Papel e condomínio conferidos em todas as rotas `devices/:id`; segredos (`webhook_token`, `api_user`, `api_password`) só saem para o síndico; o condomínio do terminal não pode ser trocado.
- **T1 (alto, CONFIRMADO no código):** desativar (`ativo=0`, que a própria API recomenda em `facial/facial.service.ts:1937`), trocar o tipo ou excluir o terminal não limpa o aparelho (`updateDevice` `1669-1816`; `removeDevice` apaga em `1949` sem `removePerson`). Toda a manutenção depois só enxerga `ativo: 1, tipo: 'facial'` (`unsyncAllForCondominio` `4184-4190`, syncs, `tickFantasmas` `4747-4752`) e os eventos do aparelho inativo são recusados (`5142`, `5151`). Se o aparelho segue ligado à fechadura, morador removido e visitante vencido continuam entrando, sem registro. Ao reativar, a carga só cadastra. Direção: enfileirar a remoção de todos os rostos antes de desativar, excluir ou trocar o tipo, ou manter inativos na varredura.
- **T2 (médio, CONFIRMADO):** tirar a área de um terminal não devolve os moradores removidos pela regra de reserva (a reconciliação só roda com área, `1786`), e mudança de área ou do controle por reserva não entra na auditoria (`1748-1758`).
- **T3 (baixo, PLAUSÍVEL):** abrir porta manual aceita terminal desativado (`getDevice` sem filtro de `ativo`, `1140-1141`; `triggerDevice` `2078-2085`). Registra operador e `MANUAL_OVERRIDE`.
- **T4 (baixo, PLAUSÍVEL):** no caminho do agente, o endereço do terminal só tem a validação do cadastro (aceita host da rede local); o HTTP direto confere destino, DNS rebinding e redirecionamento na hora (`facial-device-client.service.ts:146-195`). Só o síndico cadastra.

## Vida do condomínio (assembleias, ocorrências, comunicados, documentos)
Nada crítico: voto é travado (assembleia → votação → apartamento sob lock, READ COMMITTED com retry), tela e ATA usam a mesma apuração, ocorrências privadas têm o mesmo recorte em todas as rotas, listagens, push e relatórios.
- **V1 (médio-alto, CONFIRMADO):** a ATA e a apuração de assembleia finalizada são `Documentos` comuns; `documentos.remove` exige só `assertStaff` (síndico ou funcionário sem flag) e o tenant, sem olhar `is_ata` nem a referência da assembleia (`documentos/documentos.service.ts:127-133`; `id_documento_ata` sem FK em `prisma/schema.prisma:683-684`). Dá para apagar a ATA com código de integridade, e `documentos/insert` com `is_ata: 1` publica uma "ATA" falsa com push para todos. O comentário do `finish()` diz "imutável" (`assembleias/assembleias.service.ts:729`). Direção: recusar remover documento referenciado por `Assembleias.id_documento_ata` (e a apuração) e reservar `is_ata=1` ao `finish`.
- **V2 (médio, CONFIRMADO):** ex-morador de unidade excluída continua recebendo push de comunicado, convocação, enquete e ATA, o feed com o texto dos comunicados dos últimos 30 dias e as ocorrências públicas: os leitores derivados usam `Moradores` (`comunicados/avisar-moradores.util.ts:21-24`; `auth/mobile-auth.service.ts:2148-2154, 2284-2298, 5582-5598`) e `apartamentos.remove` só zera bloco/apto (`apartamentos/apartamentos.service.ts:398-409`). Mesma raiz do W2.
- **V3 (médio):** cadastro de unidade pelo app não deduplica (`auth/mobile-auth.service.ts:5482-5490`); `bloco` NULL × '' escapa do `@@unique` (`prisma/schema.prisma:346`). Duas linhas para a mesma unidade inflam o quórum (`assembleias.service.ts:1465, 1658`) e podem dar dois votos se proprietário e inquilino estiverem um em cada. Só o console usa `chaveUnidade` (`apartamentos.service.ts:153-163`).
- **V4 (baixo, PLAUSÍVEL):** voto antigo (pré-15/11) de quem hoje é "membro" conta na pauta de assembleia, contra o texto da ATA (`assembleias.service.ts:1700-1706`, `1281`; `motivoSemDireito` só roda no `registerVoto`).

## Portaria (API + portaria-web)
- **K1 (alto, CONFIRMADO; caminho Pessoas/Visitas):** ao redirecionar o pedido para outra unidade (`visitantes/visitantes.service.ts:3741-3772`), só a visita nova vira `pendente`; a `principal` (pedido do 101) não é cancelada nem tem o card encerrado (`card-ao-vivo/card-ao-vivo.service.ts:165` encerra só o pedido novo). O morador do 101 ainda toca AUTORIZAR por até 10 min e a visita original vai a `liberado=1` com enrolamento facial (`3856`, `3885`), mesmo que o 102 negue. O legado troca a unidade na mesma linha e não tem o problema (`5406-5419`). Direção: cancelar o pendente da `principal` e chamar `encerrar('visita', principal.id)`.
- **K2 (médio; efeito CONFIRMADO, gatilho PLAUSÍVEL):** celular que troca de dono sem o logout chegar ao servidor continua recebendo fases e encerramento dos cards do usuário anterior (nome do visitante e unidade), por até 10 min na portaria e 2 h no delivery: o upsert do `fcm_token` migra o aparelho sem encerrar `Cards_Ao_Vivo` (`auth/mobile-auth.service.ts:2537-2577`).
- **K3 (médio-baixo):** o card do delivery vai ao dono do aviso sem conferir o vínculo atual, e ele ainda pode responder (`delivery/delivery.service.ts:1084-1087`, `415-419`); o push comum confere (`1193`).
- **K4 (baixo-médio):** no pedido do portão, depois que um morador vira dono, os cards dos outros são fechados e logo reabertos por até 2 h (`delivery.service.ts:513-517, 1084-1085`).
- **K5 (baixo, PLAUSÍVEL):** fases do delivery sem guarda de ordem; uma atualização com foto lenta pode sobrescrever a mais nova (`card-ao-vivo.service.ts:238-250, 590-598`).
- Ressalva: encomenda sem bloco casa moradores de todos os blocos com o mesmo número de apto (`encomendas/encomendas.service.ts:468`).
- **P4 (médio, CONFIRMADO):** autorizar e negar ao mesmo tempo → as duas passam, última gravação vence (`visitantes/visitantes.service.ts:3861→3870, 3916→3918`; legado `5446→5454, 5500→5502`). Variante: `assertNegativaConhecida` (check-in `3487`, liberar `3612`, legado `5121/5176`) também lê e depois grava; um negar entre a leitura e o update do porteiro é sobrescrito com `liberado=1`. Direção: `updateMany({ where: { id, auth_status: 'pendente' } })` e `count === 0` = "já respondido".
- **P3 (alto se a flag estiver desligada):** `liberarAcesso` legado zera `data_entrada` de quem já está dentro (`5168-5189`); `solicitarAutorizacao` legado idem (`5378/5414`).
- **P7 + varredura do padrão sem zone.js (médio):** a portaria-web é zoneless e nenhum componente é OnPush; resposta HTTP ou callback de biblioteca só atualiza a tela se um signal lido pelo template mudar. O código já foi limpo quase todo; sobram 4 casos:
  - scanner de etiqueta das encomendas (callback do ZXing, `encomendas/encomendas-page.component.ts:932-969`): o modal fica aberto e o campo vazio após a leitura;
  - erro do scanner (`938-942`): sem câmera ou sem o CDN, o modal fica preto e a mensagem nunca aparece (ela mora dentro do `@if (isScanning)`, que fecha junto);
  - webcam da retirada (`1078-1082`): sem webcam, depois do alert a caixa segue com "Capturar", e capturar grava um **JPEG preto como comprovante** (`1085-1096`, segue em `confirmarRetirada` 611/624);
  - "Editar morador" (`moradores/moradores-page.component.ts:372-378, 423`): `showForm` é gravado no `subscribe`, então o formulário só abre no clique seguinte (conferir clicando).
  - Modelos corretos no próprio código: `iniciarCamera` com signal em visitantes (`1119-1140`), `markForCheck` em encomendas (`591`), `documentos` (`105-108`).
- **P1 resto (baixo):** o grave foi corrigido (409 na negativa; status só "Autorizado" com `liberado=1`). Sobra: o legado não expõe "negado" (`1611, 1651`), e o porteiro recebe 409 sem ver a negativa.
- **P8 resto (baixo):** "Liberar Catraca" do modal sem trava de duplo clique (`visitantes-page.component.html:2067, 2112, 2188`).
- **A2 (baixo):** no Android, NEGAR da portaria pelo card não fecha o card quando o servidor recusa (o delivery fecha) (`click-cond-app/.../card_ao_vivo/card_android.dart:351-367`).

## App ↔ API
- **C1 (alto, CONFIRMADO):** vagas e veículos mandam só `id_condominio` (`controller_vagas.dart`, `controller_veiculos.dart`); a API resolve o primeiro vínculo com `findFirst` sem unidade e sem `orderBy` (`auth/mobile-auth.service.ts:6088-6092`, `6336-6339`). Dono do 101 e do 202 abre o 202 e opera o 101 (vagas, visitante liberado, veículo e tag da Guarita). Convites já resolvem isso (`convites/convites.service.ts:206-221`).
- **C2 (médio, CONFIRMADO):** "Notificar inadimplente" responde 201 (`financeiro/financeiro.controller.ts:128-137`, sem `@HttpCode(200)`) e o app exige 200 (`controller_financeiro.dart:72`) → mostra falha depois de enviar; o reenvio duplica push e e-mail.
- **C3 (médio):** staff no app não dá baixa em encomenda "Esperando" (pré-registro iFood): o app oferece "Dar Baixa", a API só aceita 'Aguardando' (`encomendas/encomendas.service.ts:577-591`), e o app não tem "Receber".
- **A3 (médio, condição rara):** push comum de autorização sem `id_condominio` (`visitantes.service.ts:5349-5353`); o toque abre os pendentes filtrados pelo condomínio aberto no app. Quem tem vínculo em 2 condomínios e aparelho sem card ao vivo vê a lista vazia.
- **C4 (baixo/médio):** push "financeiro" com o app fechado abre sem condomínio → 403 (`firebase_service.dart:288-293`; `financeiro.service.ts:1650`).
- **C5 (baixo):** pré-registro de encomenda pelo morador sem trava de toque duplo (`list_encomendas.dart:538-556`).
- **C6 (baixo):** período da vaga exibido no dia UTC (`models/vaga_model.dart:29-32`).

## Financeiro × Superlógica
Premissa: em produção as mutações do financeiro local respondem 403 (`financeiro.controller.ts:45-355`). Quem escreve é o sync, a recorrência, o comprovante e as contas pessoais do morador.
- **S1 (alto, CONFIRMADO):** leitura com `status: 'validos'` (`superlogica/superlogica.service.ts:102`) e sync só faz upsert (`superlogica-sync.service.ts:292-385`); qualquer `fl_status_recb` ≠ '3' vira pendente (`superlogica.service.ts:166, 183`). Cobrança cancelada/renegociada no ERP segue como dívida no Prestare, com Pix e linha digitável, e o síndico não consegue apagar.
- **S2 (alto):** "Reenviar moradores" casa contato só por CPF/e-mail (`superlogica-write.service.ts:184-196, 504-513`) → duplica no ERP real quem está lá só pelo nome; a importação não amarra o vínculo no ramo "já existia" (`crm/crm-superlogica.service.ts:369-388`).
- **S3 (alto):** linha digitável reaproveitada da 1ª raspagem mesmo quando valor/vencimento mudam (`superlogica-sync.service.ts:339-347, 379`).
- **S4 (alto):** trocar/desvincular o condomínio do ERP só zera `id_superlogica_uni` (`crm/crm-superlogica.service.ts:142-162, 203-232`); ficam as cobranças do outro prédio, `id_superlogica_con` e `superlogica_escrita=1`.
- **S5 (médio):** reenvio em lote durante o envio automático do app duplica contato (checagem fora da seção crítica; `lotesRodando` em memória).
- **S6 (médio):** morador do 202 (sem unidade no ERP) é gravado na unidade do 101 do mesmo dono (`superlogica-write.service.ts:271-275, 295`).
- **S7 (médio):** "Notificar inadimplente" soma faturas ainda não vencidas (`financeiro.service.ts:1529-1541, 1593-1661`).
- **S8 (baixo):** `DT_ENTRADA_RES` vai ao ERP com o dia de UTC (`superlogica/superlogica.client.ts:89-93`).

## Relatórios, exportações e auditoria
Escopo por condomínio e papel corretos; CSV protegido contra injeção de fórmula (`common/csv.util.ts:11-14`); nenhuma rota apaga ou altera `audit_logs`. A falta de máscara de documento já é risco registrado no vault; o que é novo:
- **X1 (alto, LGPD, CONFIRMADO):** download de relatório (visitantes, encomendas, ocorrências, financeiro) não deixa rastro: `generate` não chama a auditoria (no serviço só há registro no CSV da própria auditoria, `relatorios/relatorios.service.ts:931-943`) e o `AuditInterceptor` ignora GET (`common/interceptors/audit.interceptor.ts:145-148`). Um porteiro baixa sem datas todos os visitantes da história do condomínio, com documento inteiro (`relatorios.service.ts:209, 242`), e nada fica registrado. O export completo LGPD grava `ip` sempre nulo (os controllers não passam o IP, `relatorios.controller.ts:47-50, 190-193`).
- **X2 (médio, CONFIRMADO):** na exportação de moradores, qualquer operador desliga a máscara com `?mascarar=false` (`moradores/moradores.controller.ts:47-48`); a finalidade é opcional e o registro sai como `STATUS`, não `EXPORT` (`moradores.service.ts:2058-2066`).
- **X3 (baixo-médio, PLAUSÍVEL):** paginação da auditoria sem desempate por `id` com `created_at` em segundos (`relatorios.service.ts:801-806`); os eventos já desempatam.
- **X4 (baixo-médio):** CSV da auditoria corta em 10.000 linhas sem avisar e mostra horário UTC (`relatorios.service.ts:834, 843`); download de relatório com data mal formada dá 500 em vez de 400 (`relatorios.controller.ts:65-66`).

## Assistente de IA
Isolamento correto: a busca de trechos, a reindexação e a remoção filtram por `id_condominio`; toda ferramenta tira usuário e condomínio do token; nada grava sem o toque em Confirmar; o histórico é isolado por dono.
- **I1 (médio, PLAUSÍVEL):** o card de confirmação de "lançar conta" mostra o PIX copia-e-cola só como "Disponível" (`chat-ia/chat-ia.acoes.ts:413, 422, 439`), e os trechos de documento entram na instrução de sistema sem marca de dado não confiável (`chat-ia/chat-ia.service.ts:1002-1004, 1037-1038`). Um PDF com instrução escondida pode fazer o modelo propor um PIX do atacante, que depois aparece em "Copiar código PIX".
- **I2 (baixo-médio):** a cota diária não é atômica (lê, soma, grava; `common/cota-ia.ts:44-68`), e a cota de 300 por condomínio é compartilhada: cinco contas esgotam o assistente do prédio.
- **I3 (médio):** a ATA de assembleia nunca é indexada (`assembleias/assembleias.service.ts:803, 813` não chama o índice) e nenhuma tela dispara o reindex; vetores anteriores à troca Gemini → Bedrock (768 → 512) ficam ignorados até um reindex.
- **I4 (baixo-médio, PLAUSÍVEL):** cada pergunta carrega e faz o parse de todos os vetores do condomínio em memória (`chat-ia.service.ts:757-774`).

## Banco de dados
- **D1 (alto):** `fk_vaga_benef` e `fk_vaga_veiculo` sem `ON DELETE` (= RESTRICT) (`prisma/schema.prisma:501-502`; `DEPLOY_VAGAS.md:42-43`). Revogar vaga só faz `ativo=0`, então quem já recebeu vaga não pode ser removido (400 P2003) nem excluir a conta (500); veículo que já esteve em vaga não pode ser excluído. No `deleteAccount`, o `unsyncMorador` sai sem `await` antes do DELETE (`auth/mobile-auth.service.ts:2441-2462`). A purga do CRM já contorna isso (`crm/crm-condominios.service.ts:810-813`). Direção: recriar as duas FKs com `ON DELETE SET NULL`.
- **D2 (alto):** reserva de área sem trava: `insertAgendamento` (`areas-sociais/areas-sociais.service.ts:838→959`) e aprovação (`1523`) conferem conflito em memória. Voto usa `FOR UPDATE`; delivery e credenciais usam `comLock`.
- **D3 (médio, segurança):** código de redefinição de senha lê `tentativas`, roda bcrypt e só depois incrementa (`auth/mobile-auth.service.ts:3366-3395`) → rajada paralela passa do limite de 5. O MFA já reserva a tentativa atomicamente (`auth/mfa/mfa.service.ts:143-152`).
- **D4 (médio):** `Apartamentos_Users` sem unique (id_apto, id_user) → vínculo e Moradores duplicados; a remoção deixa uma linha de Moradores órfã com foto, tag e QR.
- **D5 (médio):** `Consentimentos` com `ON DELETE CASCADE` do usuário (`prisma/sql/2026-09-11-consentimentos.sql:29-30`) contradiz a política de guardar a prova (`docs/operacao/classificacao-e-retencao-de-dados.md:28, 90`).
- **D6 (médio):** reserva feita "pela unidade" grava o morador mais antigo como dono (`areas-sociais.service.ts:888-899`) e `fk_asa_user` é CASCADE → ele exclui a conta e somem as reservas futuras da unidade.
- **D7 (médio, escala):** PIN único de visita busca `codigo_acesso` sem `id_condominio` e sem índice utilizável (`common/visita-passagem.util.ts:89-97`); ticks filtram `data_hora_termino/inicio` sem índice.
- **D9 (baixo):** `mfa_challenges` e `user_trusted_devices` criadas por `db push`, sem DDL versionado.
- **D10 (baixo, PLAUSÍVEL):** câmera de placas Dahua sem campo `UTC` → hora local lida como UTC (`facial/webhook-payload.util.ts:143, 185-189`).

## Já corrigido no main (achado na árvore antiga, descartado)
- "Hoje" em UTC no `tickReservasAreas` (agora `hojeBrasilia()`).
- P1 grave: negação do morador virando "Autorizado" e check-in liberando (9c6b1be3, ab1781a5, e5e02fab, dc45b5ba).
- P2 aba de prestadores vazia com a flag ligada (9c6b1be3).
- P5 retirada de encomenda pelo morador sem trava (3aae36ae, 73ecf4a8).
- P6 todo 401 derrubando a sessão da portaria-web (e82f4619, 9d34396f).
- P9 previsão do delivery 3 h antes (2799d9a1, 524c7a03).
- P10 delivery "Agendada" presa na fila (ac3826cc, bbcc687d).

## Verificado e correto
- Isolamento entre condomínios: varredura mecânica de todos os serviços no main; os que não fazem assert recebem id já validado pelo guard. Veículos e vagas resolvem o morador pelo usuário do token (o problema do C1 é a unidade, não o condomínio).
- Evento do terminal facial: todo lookup usa o `id_condominio` do dispositivo (38 pontos).
- QR dinâmico na leitura: MAC antes de qualquer estado, condomínio da credencial e do alvo, revogação, anti-reuso por unique.
- Revogação de morador (consentimento, menor, sem foto, remoção web/app, exclusão de conta) desmatricula o rosto e revoga o passe da carteira nos três caminhos.
- Expiração automática de visitantes (legado e Pessoas/Visitas); visitante negado é barrado no leitor (`liberado !== 1`).
- Datas: financeiro, assembleias, áreas sociais, delivery e visitas usam Brasília; SQL cru todo parametrizado; schema × SQL manual sem divergência (exceto D9).
- Guarita: token do agente amarra condomínio e aparelho; abertura de portão com `assertTenantStrict`; frames API × agente batem nos limites; hora dos eventos com fuso e deriva certos; todos os caminhos de saída enfileiram remoção.
- Superlógica: escrita só por `unidades/post`, sucesso conferido relendo a unidade, CPF validado, nada sai sem `superlogica_escrita=1`; upsert por chave única.
- Push só no aparelho ativo é decisão (e3f1af53, 13/08), não bug; o comentário de 11/08 sobre "vários aparelhos" ficou desatualizado.

## Para fechar os PLAUSÍVEIS
1. **Flag `PESSOAS_MIGRATION_ENABLED` no EB** (decide se o P3 está ativo). O vault diz "ligada desde 20/09, não conferida". Sem credencial AWS nesta máquina.
2. **SQL só de leitura no RDS** para D1, D2, D3, D4, D7, D9 e D10 (arquivo `sql-leitura-rds.sql` da varredura, copiado abaixo).
3. **Bancada com a central Linear** para G1, G4 e os itens listados no Guarita.
4. **Condomínio "teste Api prestare" na Superlógica** para S1 (o que a listagem devolve depois de cancelar), S2 (contatos sem CPF/e-mail) e S3 (editar valor muda a linha?).

```sql
-- D1, D5, D6: regra real das FKs
SELECT TABLE_NAME, CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN
 ('fk_vaga_benef','fk_vaga_veiculo','fk_vaga_visitante','fk_mor_user','fk_veiculo_morador','fk_consent_user','fk_asa_user');
SHOW CREATE TABLE Vagas;
SELECT COUNT(*) FROM Vagas WHERE id_morador_beneficiario IS NOT NULL OR id_veiculo IS NOT NULL;
-- D2: reservas sobrepostas já existentes
SELECT a.id, b.id FROM Areas_Sociais_Agendamentos a JOIN Areas_Sociais_Agendamentos b
  ON a.id_area_social = b.id_area_social AND a.data = b.data AND a.id < b.id
 WHERE a.status IN ('pendente','aprovado') AND b.status IN ('pendente','aprovado')
   AND a.hora_de < b.hora_ate AND b.hora_de < a.hora_ate;
-- D3
SELECT MAX(tentativas) FROM redefinicoes_senha;
-- D4
SELECT id_apto, id_user, COUNT(*) c FROM Apartamentos_Users GROUP BY id_apto, id_user HAVING c > 1;
SHOW INDEX FROM Apartamentos_Users;
-- D7
SHOW INDEX FROM visitas; SHOW INDEX FROM Visitantes;
EXPLAIN SELECT id FROM visitas WHERE codigo_acesso = '123456' AND data_saida IS NULL LIMIT 1;
-- D9
SHOW CREATE TABLE mfa_challenges; SHOW CREATE TABLE user_trusted_devices;
-- D10
SELECT id_device, COUNT(*), AVG(TIMESTAMPDIFF(MINUTE, `timestamp`, created_at)) AS atraso_min
  FROM Acessos_Facial GROUP BY id_device HAVING ABS(atraso_min) > 120;
```

Flag no EB (CloudShell, só leitura, filtra só esta variável):
`aws elasticbeanstalk describe-configuration-settings --application-name <app> --environment-name <env> --query "ConfigurationSettings[0].OptionSettings[?OptionName=='PESSOAS_MIGRATION_ENABLED'].Value" --output text`
