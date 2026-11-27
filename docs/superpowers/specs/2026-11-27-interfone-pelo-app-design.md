# Interfone pelo app (atender o facial no celular) — desenho

Data: 27/11/2026 · Branch `feat/interfone-app` (a partir de `origin/main` 7ffe6e58).

## Intenção

O morador atende o visitante pelo celular. O visitante chega ao facial, digita (ou escolhe) o apartamento, e o celular de todos os moradores daquela unidade toca como uma ligação, mesmo com o app fechado e com o morador fora de casa. Quem atende vê a câmera do facial, conversa com o visitante e abre o portão pelo app. Se ninguém atender, a chamada passa para o console da portaria.

Serve para o condomínio que não tem interfone (o celular vira o interfone) e para o que tem interfone IP nos apartamentos (o monitor do apartamento toca junto com os celulares). Como o celular passa a ser o interfone, a conversa também vale entre portaria e apartamento, nos dois sentidos: o porteiro liga para a unidade pelo console e o morador liga para a portaria pelo app.

É um **módulo à parte**: só alguns condomínios contratam. O síndico liga e desliga no console web; a opção só aparece para quem contratou.

## Objetivos

- Visitante no facial digita ou escolhe a unidade e a chamada começa, com tom de chamando.
- Todos os celulares dos moradores da unidade tocam com a tela nativa de ligação (CallKit no iPhone, tela cheia no Android), com o app fechado.
- O primeiro que atende fica com a chamada; os outros param de tocar.
- Na chamada: vídeo do facial, áudio nos dois sentidos, botão **Abrir portão**.
- Ninguém atendeu no tempo definido → toca no console da portaria, que atende igual (vídeo, áudio, abrir).
- Monitor IP do apartamento, quando existir, toca junto.
- O porteiro liga para uma unidade pelo console (tocam os celulares e o monitor IP, igual).
- O morador liga para a portaria pelo app (tocam os consoles de portaria abertos).
- Foto do visitante tirada no começo da chamada do facial, mostrada no app e no console e guardada no registro por 90 dias.
- Facial Intelbras configurado pelo próprio sistema (conta SIP e lista telefônica sempre em dia), se o aparelho permitir.
- Toda chamada fica registrada: tipo, quem chamou, unidade, quem atendeu, quanto durou, se o portão abriu e por quem.
- Funciona com qualquer facial que fale SIP padrão (Intelbras, Hikvision, Control iD — ver "Aparelhos").

## Fora do escopo (v1)

- Interfone analógico (centrais com ATA, "interfonia híbrida"). Exige hardware e instalação por condomínio; o analógico existente continua funcionando sozinho, sem integração. Entra quando um cliente com interfone analógico pedir.
- Gravação de áudio ou vídeo das chamadas (exige aviso a moradores e visitantes, guarda pesada e quase nada além do que a foto já dá).
- Configuração automática de faciais de outras marcas (Hikvision, Control iD): instalador configura à mão com os dados do console.
- Morador ligar para outro apartamento.
- Ligação para número de telefone comum (não há tronco para a rede telefônica).
- O SS 3530 MF FACE W (só tem um botão físico que liga para um número fixo) e o Hikvision DS-K1T671M (a ficha não cita SIP).

## O que seria um fracasso mesmo funcionando

- O celular não tocar com o app fechado ou com a tela bloqueada (o morador perde o visitante).
- O portão abrir por alguém que não estava na chamada, ou por uma chamada já encerrada.
- O facial mostrar nome de morador, ou qualquer pessoa descobrir quem mora em qual unidade pela tela.
- Alguém tocar os celulares de um prédio inteiro em série pelo facial (trote) sem limite.
- A central virar porta de entrada para fraude ou para ligar para fora.
- O morador antigo (app sem o recurso) não saber que tem alguém chamando.
- Visual fora do Prestare Dark nas telas novas.

## Restrições

- Produção: API NestJS no Elastic Beanstalk (`deploy-api.yml` a partir do `main`, push em `main` e `master`), console Angular sem zone.js no Amplify, app Flutter. Express é só dev.
- Conta AWS 850401152034, região sa-east-1. RDS privado (SQL manual idempotente pelo CloudShell + túnel, aplicado antes do push). Variáveis do EB no limite de 4096 caracteres: segredo novo vai para o S3 privado ou SSM (há `common/segredos-ssm.ts`).
- Sem Docker e sem banco local.
- A porta já abre por `FacialService` → `FacialDeviceClientService.triggerRelay()` → agente local (`open_door`, timeout curto) ou HTTP direto. Comandos que esperam o agente ficam abaixo de ~25 s (CloudFront corta a 30 s).
- APNs já tem cliente próprio (`card-ao-vivo/apns.client.ts`, chave `.p8` V76D4R22A2 no S3, bundle `br.com.clickprestare.app`). A mesma chave serve para push VoIP (tópico `br.com.clickprestare.app.voip`, `apns-push-type: voip`).
- Aparelhos dos moradores: `Users_Devices` (token FCM único; colunas do card ao vivo `card_token_inicio`, `card_android`, `card_versao`). Unidades: `Apartamentos` (`bloco`, `apto`, único por condomínio) e `Apartamentos_Users`.
- Rótulo de unidade padrão "Bloco A · Apto 106" (`rotuloAptoBloco`/pipe `unidade`).
- Visual estritamente Prestare Dark (cantos retos, Barlow Condensed maiúsculo, cor só em ponto de 6 px).
- Callback fora de evento no console grava em signal (console sem zone.js).
- iPhone: todo push VoIP recebido **tem** de virar uma ligação no CallKit na hora, senão o iOS mata o app e para de entregar VoIP push.
- Android 14+: tela cheia de ligação exige a permissão `USE_FULL_SCREEN_INTENT` declarada no Play Console como app de chamada.
- Não existe hoje área de módulos no console; esta é a primeira.

## Caminhos considerados

| Caminho | Como funciona | Por que sim ou não |
|---|---|---|
| **A. Central de telefone IP própria na AWS** | Asterisk numa EC2 recebe a chamada do facial; um serviço nosso decide quem toca, acorda os celulares e passa para a portaria | Vale para todas as marcas com SIP padrão, traz o vídeo do próprio facial, não depende do PC do condomínio. Custo: um servidor novo para operar |
| B. Agente local como central | O facial liga para o PC da portaria; o agente repassa para a nuvem | O interfone para quando o PC desliga; áudio e vídeo ao vivo dentro do `.exe` auto-atualizável é a parte mais arriscada de mexer |
| C. Serviço pronto (Twilio, Chime, LiveKit SIP) | O facial registra no serviço; o app usa o SDK dele | A entrada por SIP desses serviços é só áudio: perde o vídeo do facial. Cobrança por minuto, dependência de fornecedor |
| D. Guardian da Intelbras | App da Intelbras | Não é o app Prestare; só Intelbras |

Escolhido pelo dono do produto: **A**.

## Desenho

### Visão geral

```
Facial (SIP, G.711 + H.264) ──SIP/RTP──► Asterisk (EC2, IP fixo)
                                            │  ARI
                                            ▼
                                   serviço de chamadas (Node, mesma EC2)
                                            │  HTTP interno (token)
                                            ▼
                                   API NestJS (EB) ── push VoIP/FCM ──► celulares
                                            │                              │
                                   console da portaria ◄──WebRTC (WSS)──► Asterisk ◄──WebRTC (WSS)── app
```

- **Asterisk** (versão LTS atual, PJSIP) só cuida de sinalização e mídia. Tem IP fixo (Elastic IP) e nome `voz.prestarecondominios.com.br` (certificado TLS válido, exigido pelo WebRTC).
- **Serviço de chamadas**: processo Node/TypeScript na mesma máquina, ligado ao Asterisk pela ARI (app Stasis `prestare`). É onde mora a lógica da chamada (estado, tempos, quem atende, transferência). Fica fora do EB porque precisa de uma conexão ARI permanente e de um único dono por chamada.
- **API NestJS**: dona dos dados. O serviço pergunta à API quem toca e avisa a API de cada mudança de estado; a API manda os pushes, grava o registro e abre o portão. Rotas internas protegidas por token interno (mesmo padrão do `INTERNAL_SYNC_TOKEN`); rotas do app e do console com o JWT de sempre.
- O facial só precisa de internet de saída (registro SIP de dentro da rede do condomínio, com keepalive). Nada de abrir porta no roteador do condomínio.

### Contas na central

- **Facial**: um endpoint por `Facial_Devices` habilitado (`fac-<id>`), senha aleatória longa gerada pelo sistema. O contexto do facial só permite entrar no Stasis; ele não consegue ligar para nenhum outro lugar.
- **Monitor IP do apartamento** (condomínio com interfone IP): endpoint por monitor (`mon-<id>`), ligado a uma unidade. O monitor fica registrado **nas duas centrais**: na do condomínio (continua fazendo o que faz hoje, inclusive portaria ↔ apartamento) e na Prestare (recebe as chamadas do facial). As telas Intelbras TVIP 22XX aceitam até dois servidores SIP; outras marcas, confirmar na bancada. O botão de abrir do monitor manda DTMF; a central Prestare intercepta esse DTMF e transforma no mesmo "abrir" auditado do app (não repassa ao facial).
- **App e console**: não ficam registrados o tempo todo. Recebem uma credencial de curta duração da API na hora de atender ou de ligar para a portaria (app) ou enquanto a tela da portaria está aberta (console), via WSS.
- Endpoints vêm do banco (cadastro dinâmico pelo serviço ou PJSIP realtime; escolha do implementador). Nenhum endpoint fixo com senha conhecida.
- DTMF por endpoint de facial conforme a marca (Intelbras: SIP INFO; Control iD: RFC 2833).

### Número da unidade (ramal)

- Cada `Apartamentos` do condomínio com o módulo ganha um **ramal**: só dígitos, único no condomínio.
- Sugestão automática: os dígitos do `apto` quando não colidem no condomínio. Havendo colisão (dois blocos com "106"), o console marca as unidades em conflito e o síndico define (ex.: 1106, 2106). Nada é adivinhado em silêncio.
- **Blocos atendidos por facial**: cada facial habilitado tem a lista de blocos que ele chama (padrão: todos). Condomínio com um facial por torre restringe cada um à sua torre; número de unidade fora dos blocos daquele facial = "Apartamento não encontrado". A lista telefônica é gerada por facial.
- O que o visitante vê no facial: bloco e apartamento, **nunca** nome de morador.
  - Intelbras (lista telefônica): o console gera a planilha no modelo da Intelbras (arquivo `phoneBook`), com bloco, andar e ramal, para o instalador importar.
  - Control iD: modo "teclado numérico ou lista de contatos"; o ramal é o número digitado.
  - Hikvision: a definir na bancada.

### Fluxo de uma chamada

1. Visitante digita o ramal no facial. O facial manda INVITE para a central; o plano de discagem entrega ao Stasis.
2. O serviço identifica o facial pela conta (`fac-<id>` → dispositivo e condomínio) e pede à API o destino: `POST /interno/interfone/chamadas` com dispositivo e número discado.
3. A API valida (módulo ligado e contratado, facial habilitado, limite de chamadas) e responde com: id da chamada, unidade (rótulo), tempo de toque, se transfere para a portaria, monitores da unidade. Ao mesmo tempo:
   - grava a chamada (`chamando`);
   - manda push para os aparelhos dos moradores da unidade que podem receber (ver "App");
   - número sem unidade → resposta "não encontrado"; o serviço toca a mensagem "Apartamento não encontrado" e desliga.
4. O serviço mantém o visitante ouvindo "chamando" (sem atender o canal do facial) e liga para os monitores da unidade, se houver.
5. **Toque por push, conexão só ao atender.** Os celulares tocam pela tela nativa (o push carrega id da chamada, unidade, nome do portão e condomínio). Quando o morador toca em Atender, o app pede à API uma credencial curta para aquela chamada, conecta por WebRTC e entra na chamada pelo id; o serviço atende o canal do facial e junta os dois. Assim nenhum celular precisa ficar registrado na central.
6. Primeiro a atender leva. Os outros aparelhos recebem o aviso de "atendida em outro aparelho" e encerram a tela de ligação; um segundo que tente entrar recebe "já atendida".
7. **Recusar** num celular para só aquele aparelho. Se todos os aparelhos que tocaram recusarem, a chamada vai para a portaria na hora, marcada "Morador recusou".
8. **Tempo de toque esgotado** (padrão 30 s, configurável 15–60) sem ninguém atender → se "transferir para a portaria" estiver ligado e houver console aberto, o serviço liga para os consoles abertos do condomínio (todos tocam, o primeiro leva), marcada "Morador não atendeu". Celulares param de tocar.
9. Portaria também não atende (padrão 45 s) ou não há console aberto → o serviço toca a mensagem "Ninguém atendeu. Tente novamente mais tarde." e desliga. Registro `nao_atendida`; os moradores recebem push comum "Chamada perdida do portão às HH:MM".
10. Duração máxima da conversa: 3 minutos (aviso aos 2:30), depois encerra. Visitante desligou → todos param de tocar e a chamada fecha.

Estados: `chamando` → `atendida_morador` | `portaria` → `atendida_portaria` | `nao_atendida` | `recusada` (sem portaria) | `falha` → `encerrada`. Uma transição por vez, no serviço; a API grava cada uma.

### Portaria liga para a unidade

- No console da portaria, botão **Ligar** na unidade (onde a portaria já escolhe unidade: visitantes, encomendas, delivery, e uma busca de unidade no painel de chamadas).
- Mesma máquina de toque da chamada do facial: push para os celulares da unidade e toque nos monitores IP; primeiro a atender leva.
- Só áudio. No celular aparece "Portaria · <condomínio>" e a unidade. Sem botão de abrir (não há facial na chamada).
- Ninguém atende no tempo de toque → o console mostra "Ninguém atendeu"; sem transferência.
- Só login de porteiro (a mesma "portaria" da transferência).

### Morador liga para a portaria

- No app, botão **Ligar para a portaria** (aparece só com o módulo ligado).
- Toca em todos os consoles de portaria abertos do condomínio; primeiro a atender leva. Só áudio. O console mostra nome do morador e unidade.
- Nenhum console aberto → o app mostra "Portaria indisponível agora" sem tentar ligar. Ninguém atende em 45 s → "A portaria não atendeu".
- Uma chamada por vez por morador.

### Foto do visitante

- No começo de cada chamada do facial, o sistema tira **uma** foto do visitante (um quadro do vídeo da chamada ou a foto da câmera do facial pelo agente; escolha do implementador) e guarda no bucket S3 privado da API.
- O toque **não** espera a foto: o push sai na hora e a foto chega depois.
- Aparece na notificação de chamada do Android (miniatura, como no card ao vivo), na tela do app enquanto o vídeo conecta, no histórico do app e no do console. No iPhone a tela nativa de ligação não mostra imagem; a foto aparece ao atender e no histórico.
- Apagada 90 dias depois da chamada (mesma regra da selfie do entregador no autoatendimento), por rotina automática.

### Abrir o portão

- Botão **Abrir portão** no app e no console → `POST /interfone/chamadas/:id/abrir`.
- A API só abre se: a chamada está atendida, quem pede é quem atendeu (morador da unidade ou usuário da portaria do condomínio) e a chamada não acabou. Abre **o facial que fez a chamada**, pelo caminho que já existe (`triggerRelay`), e grava quem abriu.
- **Reserva por DTMF**: se o agente estiver fora do ar e o facial tiver comando DTMF configurado, a API pede ao serviço para mandar o código pela própria chamada (Intelbras avisa atraso de 2 a 5 s). Também registrado.
- O app mostra o resultado: "Portão aberto", ou "Não foi possível abrir" com o motivo.
- Uma abertura por chamada é o normal; permitir uma segunda (ex.: portão fechou antes) com o mesmo registro.

### App do morador

- **iPhone**: PushKit (token VoIP novo, guardado em `Users_Devices`) + CallKit. A tela de ligação nativa aparece com o app fechado e na tela bloqueada. Todo push VoIP vira ligação no CallKit imediatamente (regra da Apple); o "atendida em outro aparelho" chega pela conexão que o app abre ao acordar, não por outro push VoIP.
- **Android**: push FCM de dados de alta prioridade → tela cheia de ligação (ConnectionService/notificação de chamada), com toque.
  - A permissão de tela cheia (`USE_FULL_SCREEN_INTENT`) é declarada no Play Console como recurso de chamada. Se o Google não conceder por padrão, o app pede ao morador para liberar nas configurações (o Android permite) e, sem ela, toca como notificação de chamada no alto da tela, com toque contínuo e botões Atender/Recusar. O lançamento no Android **não** espera essa aprovação.
- **Tela da chamada** (Prestare Dark): vídeo do facial em cima, unidade e nome do portão, tempo de chamada, botões Mudo, Alto-falante, **Abrir portão**, Encerrar. O vídeo do morador **não** é enviado (o facial não mostra vídeo; poupa dados e privacidade): vídeo só de recebimento.
- Permissão de microfone pedida no primeiro uso do recurso, com explicação.
- Preferência por usuário: "Receber chamadas do portão" (padrão ligado). Desligado, aquele morador não toca; os outros da unidade e a portaria seguem.
- **App antigo**: só recebe ligação quem tem a versão nova (marcador de versão em `Users_Devices`, como o `card_versao`). Aparelho com app antigo recebe push comum "Visitante chamando no portão — atualize o app para atender".
- Morador com mais de uma unidade: a tela mostra qual unidade foi chamada.
- Histórico de chamadas da unidade no app (data, tipo, foto do visitante, atendida por, portão aberto).
- Botão **Ligar para a portaria** (ver acima).

### Console da portaria

- **Quem é "a portaria"**: login de porteiro (`Funcionarios_Portaria`) do condomínio com a tela da portaria aberta. Síndico e funcionário logados no console não entram na roleta. "Há console aberto" = há pelo menos um desses registrado na central naquele momento.
- Com o módulo ligado, essa tela se registra na central por WebRTC (credencial curta, renovada) enquanto estiver aberta e logada.
- O console passa a poder abrir o facial **só** dentro de uma chamada que aquele porteiro atendeu (hoje o acionamento manual do console não aciona facial); fora da chamada, nada muda.
- Chamada transferida: painel com toque, vídeo, unidade chamada, motivo ("Morador não atendeu" / "Morador recusou"), botões Atender, **Abrir portão**, Encerrar.
- O navegador precisa da permissão de microfone; o console avisa se ela foi negada ou se a central está desconectada (assim a portaria sabe que não vai receber chamadas).
- Chamada do morador: painel com toque, nome e unidade, Atender/Encerrar.
- Botão **Ligar** para a unidade (ver acima).
- Lista de chamadas do dia com tipo, foto e resultado, no padrão das outras listas do console.

### Módulo no console do síndico

- Só aparece se o condomínio tiver o módulo **contratado**: coluna em `Condominios`, ligada pela Prestare num interruptor do CRM, no mesmo padrão do `superlogica_escrita`. Cobrança e preço do módulo ficam fora deste projeto.
- Tela "Interfone pelo app":
  - liga/desliga o módulo;
  - tempo de toque no apartamento; transferir para a portaria (sim/não); tempo de toque na portaria;
  - **faciais**: marcar quais fazem chamada (lista de modelos conhecidos como ajuda), status **Registrado / Não registrado** vindo da central, comando DTMF de abertura (opcional). Intelbras: botão **Configurar automaticamente** (ver abaixo); demais marcas, ou se a automática falhar: servidor, porta, usuário e senha para o instalador e a lista telefônica Intelbras para baixar;
  - **ramais**: lista de unidades com o ramal, conflitos em destaque, edição;
  - **monitores IP**: cadastrar monitor por unidade e mostrar os dados de registro.
- Desligar o módulo: novas chamadas do facial recebem a mensagem "Serviço indisponível"; nada mais é apagado.
- Toda alteração vai para o log de auditoria existente.

### Configuração automática do facial (Intelbras)

- O agente local já conversa com o Intelbras na rede do condomínio. Com o módulo ligado, ele grava no facial a conta SIP (servidor, usuário, senha) e a lista telefônica (bloco, andar, ramal das unidades dos blocos daquele facial).
- A lista fica em dia sozinha: unidade nova, ramal editado ou blocos do facial alterados → o agente regrava a lista.
- O console mostra o estado: configurado, pendente, falhou (com o motivo). Falhou → os dados para configuração manual continuam na tela.
- Depende de o SS 3532 aceitar essas configurações pela interface local que o agente usa. **Confirmar na bancada antes de implementar**; se não aceitar, fica a configuração manual (planilha + dados na tela).
- Exige versão nova do agente.

### Registro

- Tabela nova de chamadas: tipo (facial→unidade, portaria→unidade, unidade→portaria), condomínio, facial, unidade, número discado, quem ligou, início, atendida em, atendida por (usuário e tipo morador/portaria), motivo da transferência, resultado, encerrada em, duração, foto do visitante (com data de apagar), portão aberto em/por/como (agente ou DTMF).
- Abertura de portão também entra onde as outras aberturas manuais já entram, para aparecer no histórico de acessos.
- Sem gravação de áudio/vídeo (ver "Fora do escopo").

### Proteções

- Central sem tronco para a rede telefônica: não há como ligar para fora.
- Só endpoints conhecidos registram; senhas longas e aleatórias; bloqueio automático de IP após tentativas erradas; SIP com TLS quando o facial suportar.
- WebRTC só com credencial curta emitida pela API, ligada a uma chamada (app) ou a uma sessão de portaria (console).
- Limite de chamadas por facial (ex.: 6 por minuto) e por unidade (ex.: 3 em 5 minutos); acima disso o facial ouve "Aguarde para chamar novamente". Valores finais na bancada.
- Abrir portão: só quem atendeu, só durante a chamada, só o facial que chamou.

### Aparelhos

Compatíveis pela documentação dos fabricantes (confirmar na bancada):

- **Intelbras** com SIP e lista telefônica: SS 3531 MF LITE, SS 3541 MF LITE, SS 3532 MF (W), SS 3542 MF (W), SS 5531 MF W, SS 5531 MF EX, SS 5541 MF W, SS 5532 MF W, SS 5542 MF W. Registram em até dois servidores SIP de terceiros; G.711 + H.264.
- **Hikvision** DS-K1T343 (família Value, fichas de maio/2026): SIP padrão (Asterisk na lista). Vídeo na chamada e forma de escolher a unidade: confirmar na bancada.
- **Control iD** iDFace / iDFace Max com licença PRO: SIP, vídeo H.264 opcional, teclado ou lista de contatos na tela, abertura por DTMF.

Não compatíveis: Intelbras SS 3530 MF FACE (W) (um botão físico, um número só) e Hikvision DS-K1T671M (sem SIP na ficha).

**Facial da bancada e dos primeiros clientes do módulo: Intelbras SS 3532 MF W** (decisão do dono; chega em 28/11). Mesma família do SS 3530 que o agente já controla (cadastro de rosto, abertura, eventos): conferir esses comandos nele também na bancada.

### Infraestrutura

- Uma EC2 pequena em sa-east-1 com Elastic IP: Asterisk + serviço de chamadas + TURN (coturn) para redes que bloqueiam UDP.
- Portas: SIP (5060/5061), WSS do WebRTC, faixa de RTP, TURN. Grupo de segurança só com essas.
- DNS `voz.prestarecondominios.com.br` → Elastic IP; certificado renovado automaticamente.
- Alarme se o Asterisk ou o serviço cair e se o número de faciais registrados cair de repente (assinante do alarme: ver pendência do SNS).
- Criar a máquina tem custo mensal: pedir aprovação do dono antes de criar.

### Etapas

1. Central + serviço de chamadas + API (ramal, push, registro, abrir, foto) + app iPhone e Android, testados com softphone no papel do facial e já com o SS 3532 na bancada.
2. Console da portaria (transferência, portaria liga para a unidade, morador liga para a portaria) e tela do módulo no console do síndico + interruptor no CRM.
3. Configuração automática do Intelbras pelo agente (se a bancada confirmar) e bancada completa; só então o módulo é ligado para um cliente (precisa das etapas 1 e 2).
4. Monitor IP do apartamento (pode vir depois do primeiro cliente, se ele não tiver interfone IP).

Cada etapa pode ir para produção desligada (módulo não contratado em nenhum condomínio), sem afetar quem não usa.

## Erros e casos de borda

- **Central fora do ar**: o facial não completa a chamada (o próprio facial mostra falha). Alarme dispara. Não há reserva automática na v1.
- **Agente fora do ar**: chamada funciona (não depende do agente); abrir cai na reserva DTMF ou mostra "Não foi possível abrir".
- **Celular sem internet / push atrasado**: aquele aparelho não toca; os outros e a portaria seguem.
- **Morador atende e a conexão de mídia falha**: o app mostra "Não foi possível conectar", a chamada volta a tocar nos outros aparelhos se ainda houver tempo, senão vai para a portaria.
- **Dois atendem ao mesmo tempo**: o serviço decide (um só leva), o outro recebe "já atendida".
- **Unidade sem morador com app novo**: vai direto para a portaria (se ligado) com o motivo "Ninguém da unidade recebe chamadas".
- **Facial não registrado** há mais de X minutos: status no console do síndico e no alarme.
- **Módulo desligado no meio de uma chamada**: a chamada em andamento termina normalmente.
- **Usuário perde o vínculo com a unidade** durante a chamada: pode terminar a conversa, não pode abrir.
- **Porteiro liga para a unidade e o visitante chama a mesma unidade ao mesmo tempo**: as duas tocam; o celular mostra as duas chamadas como o sistema mostra duas ligações (a segunda em espera).
- **Agente fora do ar com configuração automática pendente**: fica "pendente"; o agente aplica quando voltar.
- **Foto não saiu** (vídeo não chegou, agente fora): a chamada segue sem foto; o registro marca "sem foto".

## Testes

- API: resolução de ramal (colisão, unidade inexistente, módulo desligado, não contratado), quem recebe push (versão do app, preferência desligada, várias unidades), regras de abrir (quem atendeu, chamada encerrada, facial certo), limites de chamada, gravação do registro e do log.
- Serviço de chamadas: máquina de estados com ARI falso (atende primeiro, recusa de todos, tempo esgotado, portaria sem console, visitante desliga, duas tentativas simultâneas de atender, duração máxima).
- Console: painel de chamada (entrando, transferida, do morador), botão Ligar e tela do módulo (Jest, no padrão do projeto).
- Foto: gravação no S3 privado, acesso só por quem pode ver a chamada, rotina dos 90 dias.
- Agente: gravação da conta SIP e da lista telefônica no harness do agente (mock do Intelbras) depois de a bancada mostrar o protocolo real.
- App: estados da tela de ligação e da chamada; integração CallKit/Android no aparelho.
- **Antes do facial**: ponta a ponta com um softphone de PC com webcam fazendo o papel do facial (ex.: Linphone com vídeo H.264) e iPhone/Android reais atendendo.
- **Bancada**: com um facial compatível (Intelbras, para começar), ponta a ponta: discar, tocar com app fechado e tela bloqueada nos dois sistemas, vídeo, áudio, abrir, transferir para a portaria, monitor IP tocando junto.

## Decisões minhas (não vieram do dono do produto)

- Toque pelo push e conexão só ao atender, em vez de manter cada celular registrado na central.
- O serviço de chamadas fora do EB, na mesma máquina do Asterisk.
- Recusa de todos os aparelhos vai para a portaria, com o motivo visível.
- Tempos padrão: 30 s no apartamento, 45 s na portaria, 3 min de conversa.
- Vídeo só do facial para o celular; o morador não aparece.
- Sem gravação de áudio/vídeo; foto do visitante guardada 90 dias (mesma regra da selfie do entregador).
- Chamadas entre portaria e apartamento só de áudio; sem transferência quando ninguém atende.
- Configuração automática só para Intelbras na v1, e só se a bancada confirmar.
- Interfone analógico fora até um cliente pedir.
- Abrir pelo caminho atual (agente) com reserva por DTMF.
- Ramal por unidade sugerido pelos dígitos do apto; conflito resolvido pelo síndico, nunca adivinhado.
- Preferência por morador "Receber chamadas do portão".
- Instalador configura o facial à mão com os dados do console (sem configuração automática na v1).
- Monitor IP do apartamento registrado nas duas centrais (a do condomínio segue com o interfone interno); o botão de abrir do monitor vira o "abrir" auditado.
- "Portaria" = login de porteiro com a tela da portaria aberta; síndico e funcionário não tocam.
- Blocos atendidos por facial (padrão todos), lista telefônica por facial.
- Android sem a permissão de tela cheia toca como notificação de chamada; não segura o lançamento.
- "Contratado" é interruptor no CRM (padrão `superlogica_escrita`); cobrança fora.
- Entrega em etapas; o módulo só liga para cliente depois da transferência para a portaria.

## Deixado ao implementador

- Versão do Asterisk, cadastro dinâmico de endpoints (ARI x PJSIP realtime), e a forma de implantar/atualizar a máquina.
- Bibliotecas do app (tela nativa de ligação, WebRTC/SIP sobre WSS com recebimento de H.264) e do console (SIP.js ou JsSIP).
- Nomes de tabelas, colunas e rotas (seguindo o padrão do projeto) e o SQL manual.
- Valores finais dos limites anti-trote.
- Texto e voz das mensagens tocadas para o visitante (português, gravadas uma vez).

## Pendências que dependem do dono do produto

Nenhuma em aberto. Facial SS 3532 MF W decidido pelo dono (27/11). Entrada no escopo de portaria ↔ apartamento, foto do visitante e configuração automática, e permanência de fora do analógico e da gravação: proposta minha de 27/11, vale com a aprovação deste desenho.
