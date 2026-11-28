# Interfone pelo app — roteiro de bancada com o SS 3532 MF W

Para o teste de 28/11/2026 no condomínio de teste **Boa Vista** (único com o módulo ligado). A central de voz é `voz.prestarecondominios.com.br` (IP fixo 54.21.36.213).

## Antes de começar

1. **Microfone no console**: o cabeçalho do site ainda bloqueia o microfone (`microphone=()`). Sem trocar para `microphone=(self)`, o porteiro não atende nem liga pelo console. A troca está pronta no CloudShell e precisa da sua aprovação:
   `aws amplify update-app --app-id d340ziyanv9pav --custom-headers file://$HOME/amplify-headers-depois2.json`
   (para desfazer: o arquivo `~/amplify-headers-backup-2026-11-28.yml`, embrulhado em `{customHeaders: …}`).
2. **App no celular**: o app do interfone está só no emulador (Voltz_35) e precisa do seu login. No iPhone, só com um build novo no TestFlight (o código do iPhone ainda não foi compilado; o primeiro build vai confirmar).
3. **Porteiro**: para testar a transferência, um login de porteiro do Boa Vista aberto no console (Chrome, com o microfone permitido).

## 1. Ligar o SS 3532 no sistema

1. Atualize o firmware do SS 3532 para a versão mais recente da Intelbras (a da "Interface Web 2.0").
2. Ligue na rede da portaria com acesso à internet.
3. No console: **Terminais faciais → cadastrar** como facial Intelbras, modelo "SS 3532 MF W" (ou deixe a descoberta do agente achar).
4. Confira que cadastro de rosto e abertura funcionam como no SS 3530 (mesma família).

## 2. Conta SIP (manual)

1. Console → **Configurações → Interfone → Faciais que chamam**: marque **Faz chamadas** no SS 3532 e salve.
2. Copie os **Dados para o instalador**: servidor `voz.prestarecondominios.com.br`, porta `5060`, usuário `fac<id>` (sem hífen) e a senha (ícone do olho).
3. Na interface web do facial: **Intercomunicação → Configurações SIP** → habilite a **Conta SIP 1**, preencha servidor, porta, usuário (e usuário de autenticação, se pedir) e senha, transporte UDP. Aplique.
   - Se o facial não aceitar o domínio no campo do servidor, use o IP `54.21.36.213`.
4. Em até 1 minuto o console mostra **Registrado** no card do facial. A Conta SIP 1 do facial fica verde.

## 3. Lista telefônica

1. Console → card do facial → **Baixar lista telefônica** (arquivo `phoneBook`; não renomeie).
2. No facial: **Lista telefônica → Importar** a planilha.
3. Os ramais do Boa Vista já estão salvos: Bloco A = 1101…1110, Bloco B = 2101…, C = 3101…, D = 4101…. O seu apartamento (Bloco A · Apto 106) é **1106**.

## 4. Testes (nesta ordem)

| # | Como | O que deve acontecer |
|---|---|---|
| 1 | No facial, chame Bloco A · Apto 106 | Celular com o app novo toca (tela de ligação, mesmo com o app fechado). Atender: vídeo do facial, áudio nos dois sentidos |
| 2 | Durante a conversa, **ABRIR PORTÃO** | Abre pelo agente; console registra quem abriu |
| 3 | Chame e **não atenda** | Depois de 30 s toca no console do porteiro ("Morador não atendeu"); porteiro atende, vê o vídeo, abre |
| 4 | Chame e **recuse** no celular | Vai direto para o porteiro com "Morador recusou" |
| 5 | Chame sem porteiro logado e sem atender | Visitante ouve "Ninguém atendeu"; morador recebe "Chamada perdida" |
| 6 | Porteiro: **Ligar** para a unidade (dashboard) | Celular do morador toca; só áudio |
| 7 | Morador: **Ligar para a portaria** (app) | Console toca |
| 8 | Configure um comando DTMF de abertura no facial e no console, desligue o agente e abra pela chamada | Abre por DTMF; registro mostra "dtmf" |

## Se algo não funcionar

- Ver a central em tempo real (CloudShell, depois de `source ~/voz.sh`):
  - `voz "journalctl -u prestare-voz -n 50 --no-pager"`
  - `voz "asterisk -rx 'pjsip show endpoints'"` (o facial deve aparecer como Available)
- **Sem vídeo**: o facial manda H.264. Confira no facial se a chamada de vídeo está habilitada e, na central, `asterisk -rx 'core show channels verbose'` durante a chamada.
- **Celular não toca**: o morador precisa do app novo e do vínculo com a unidade. O sistema só guarda o **último** aparelho de cada usuário: se você abrir o app em outro aparelho, só ele toca.
- **Teste sem facial**: na central, `bash /opt/prestare-voz/atual/deploy/simular-facial.sh fac1 1106 45` (o visitante simulado fala um som de teste; não tem vídeo).

## Depois: configuração automática pelo agente (opcional)

Está preparada no branch `feat/interfone-agente` (não publicada). Antes de usar, siga o roteiro com `curl` em `.superpowers/sdd/2026-11-27-interfone-pelo-app/g1-preparatorio-report.md` para confirmar, no próprio SS 3532, os nomes de configuração (`configManager … name=SIP` e `VideoTalkContact`). Faça um backup da configuração do facial antes.
