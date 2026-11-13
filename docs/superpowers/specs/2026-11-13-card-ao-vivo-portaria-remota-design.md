# Card ao vivo da portaria remota (estilo iFood)

Data: 13/11/2026 · Status: rascunho para aprovação

## 1. Intenção

Hoje, quando o porteiro clica em **Solicitar autorização** na portaria-web, o morador recebe um push comum ("Visitante na portaria — Fulano quer entrar. Autorizar?") e um WhatsApp. Os botões Autorizar/Negar só existem com o app aberto (diálogo) ou na tela **Solicitações**.

A ideia é transformar esse pedido num **card ao vivo**, como o acompanhamento de pedido do iFood:

- no **iPhone**, uma Live Activity: card grande na tela de bloqueio e na **Ilha Dinâmica** (a área da câmera), com **NEGAR / AUTORIZAR** no próprio card;
- no **Android**, uma notificação fixa com os mesmos botões;
- em ambos, o card **acompanha o pedido até o visitante entrar**: aguardando → liberado → entrou.

O porquê é a soma de três coisas: o morador **responde mais rápido** (sem abrir o app), **não deixa o pedido passar** (o card fica fixo, com contagem) e o app **parece moderno** (argumento de venda, ver `produto-posicionamento-preco`).

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Responder (Negar/Autorizar) sem abrir o app, no iPhone e no Android.
- Card visível na tela de bloqueio e na Ilha Dinâmica enquanto o pedido estiver aberto.
- Atualização em tempo real nas fases: aguardando, liberado, entrou, negado, respondido por outro morador, expirado.
- Todos os moradores do apartamento veem o mesmo card; quando um responde, os outros veem quem respondeu.
- Visual idêntico ao design system **Prestare Dark**.

**Não-objetivos (v1)**
- Botão "Autorizar e dar entrada" no card (continua só na tela Solicitações).
- Foto do visitante no card (a Live Activity não baixa imagem da rede com o app fechado; usa o avatar com ícone de pessoa, como a tela Solicitações).
- Apple Watch, CarPlay, widgets de tela inicial.
- Mudanças na portaria-web além do que já existe.
- Mudar o WhatsApp que já é enviado.

**Anti-objetivos (falha mesmo que "funcione")**
- Card fora do padrão Prestare Dark (cantos arredondados nos botões, ilustrações, ícones coloridos, cor como fundo).
- **Autorizar sem desbloquear o aparelho.**
- Card preso em "AGUARDANDO" depois que o pedido já foi resolvido (por outro morador, pela portaria ou por expiração).
- Card chegando em aparelho de quem não mora no apartamento (ou de quem já fez logout).
- Pedido que passa despercebido porque o card não abriu (Live Activities desligadas no iPhone, app morto por fabricante Android). **Isto pesa mais que o aviso duplicado** (decisão do usuário): ver "Reserva automática" na seção 4.
- Morador recebendo dois avisos do mesmo pedido no mesmo aparelho quando o card abriu normalmente.

## 3. Visual (aprovado)

Referências aprovadas, na pasta [`2026-11-13-card-ao-vivo-portaria-remota/`](2026-11-13-card-ao-vivo-portaria-remota/):

- `01-tela-bloqueio-aguardando.png` — tela de bloqueio, fase aguardando (aprovada).
- `02-ilha-dinamica-expandida.png` — Ilha Dinâmica expandida (aprovada).
- `03-fases.html` — as demais fases desenhadas no mesmo padrão.

Fonte da verdade do estilo: design system **Prestare Dark** (artifact `Bi1sJjoHeTebLKB7dfrZkF`) e `click-cond-app/lib/theme/app_colors.dart`. Regras que valem para o card:

- Fundo `#000` / superfície `#141414`, divisor 1px `#242424`, borda de controle `#666`.
- **Cantos retos** em botões e tags. O contorno externo do card e o formato da Ilha Dinâmica são arredondados pelo iOS e não mudam.
- Barlow Condensed 600 em MAIÚSCULAS com espaçamento largo para rótulos, tag e botões; Barlow para nome e descrição; número da contagem em Barlow Condensed 300.
- Ícones de traço fino (Lucide, 1.5px). Avatar = círculo com contorno e ícone de pessoa.
- **Cor só em ponto de 6px e texto curto**: amarelo `#FFC83D` (aguardando), verde `#5EC28A` (liberado/entrou), vermelho `#FF6B6B` (negado), cinza `#666` (expirado).
- Logo Prestare (prédios com janelas amarelas) no canto do card e à esquerda da câmera na Ilha.
- NEGAR = contorno; AUTORIZAR = sólido branco com texto preto.
- Textos em português, como no mockup.

### Conteúdo por fase

| Fase | Tag | Corpo | Rodapé / ação | Ilha recolhida |
|---|---|---|---|---|
| Aguardando | ● AGUARDANDO (amarelo) | avatar, nome, "Visitante na portaria · Bloco A · Apto 106", "Chegou às 14:28", contagem `02:41` | NEGAR / AUTORIZAR | logo + `02:41` |
| Liberado | ● LIBERADO (verde) | avatar, nome, "Visitante · Bloco A · Apto 106" | etapas PEDIDO → AUTORIZADO → ENTROU (2 de 3) + "Você autorizou às 14:31. Aguardando a entrada." | logo + ● LIBERADO |
| Liberado por outro | ● LIBERADO | idem | "Autorizado por Marina às 14:31." (ou "pela portaria") + etapas | logo + ● LIBERADO |
| Entrou | ● NO LOCAL (verde) | idem + hora grande `14:33` | etapas completas + "Entrou · Visitante" | logo + ● NO LOCAL |
| Negado | ● NEGADO (vermelho) | idem | "Você negou a entrada às 14:31." (ou "Negado por Marina…") | — (encerra) |
| Expirado | ● EXPIRADO (cinza) | idem + `00:00` em cinza | "Sem resposta. A portaria decide a entrada." | — (encerra) |

"Prestador" substitui "Visitante" quando `is_prestador = 1`.

## 4. Comportamento

### Máquina de estados do card (por pedido)

```
AGUARDANDO ──autorizar (morador)──────────────▶ LIBERADO ──entrada registrada──▶ ENTROU ─▶ fim
     │      ──checkIn/liberarAcesso (portaria)─▶ LIBERADO / ENTROU
     ├──negar (morador)─────────────────────────▶ NEGADO ─▶ fim
     └──3 min sem resposta──────────────────────▶ EXPIRADO ─▶ fim
LIBERADO ──10 min sem entrada───────────────────▶ fim (card some)
qualquer ──visitante excluído / check-out / logout do morador──▶ fim
```

- **Janela de resposta: 3 minutos** (igual ao "Sem resposta" que a portaria-web já mostra, `visitantes-page.component.ts` ~697). A contagem do card é calculada a partir de `auth_solicitado_em`.
- **Expirar não muda o pedido no banco**: `auth_status` continua `pendente` e o morador ainda pode responder pela tela Solicitações. Só o card encerra. *(Decisão minha: mantém o comportamento atual da portaria.)*
- **Resposta depois que o card expirou** (pela tela Solicitações ou por `checkIn`/`liberarAcesso` da portaria): **não reabre card** nem manda aviso extra aos outros moradores, como hoje. EXPIRADO é final. *(Decisão minha.)*
- **Liberado espera a entrada por até 10 minutos**, alinhado ao `AUTORIZACAO_EXPIRACAO_MS = 10 min` que o servidor já usa (`isAutorizacaoAtual`; depois disso a portaria-web mostra expirado e o check-in é recusado). Depois disso o card some sem mudar nada no banco. *(Era 15 min na conversa; ajustado ao que o código já faz.)*
- **Fases finais ficam visíveis por um tempo curto** antes de sumir: ENTROU 5 min; NEGADO, EXPIRADO e "respondido por outro" 2 min. *(Decisão minha.)*
- **Re-solicitação** do mesmo visitante abre um card novo; o anterior, se ainda existir, é encerrado.
- **Override da portaria**: `checkIn` e `liberarAcesso` sobre um pedido pendente já marcam `auth_status = 'autorizado'` (código atual). O card mostra "Liberado pela portaria" (e ENTROU no caso do `checkIn`).

### Quem recebe

Os mesmos destinatários do push atual (`notificarMoradoresAutorizacao`): usuários vinculados ao apartamento com `notif_visitantes = 1`, em **todos os aparelhos** (`Users_Devices`, via `tokensDoMesmoDono`), não só no `Users.fcm_token`.

### Reserva automática (decisão do usuário)

Nunca perder o aviso vale mais que evitar duplicado. Por aparelho:

1. O servidor manda o card (iOS: push-to-start; Android: push de dados que monta a notificação fixa).
2. O aparelho **confirma** que o card abriu: no iOS, o app recebe do sistema o token de atualização daquela Live Activity e o envia ao servidor; no Android, o app avisa o servidor depois de exibir a notificação.
3. Se a confirmação não chegar em **~10 s**, o servidor manda **o push comum de hoje** (com bloco `notification`, exibido pelo sistema mesmo com o app morto) para aquele aparelho.

Aparelho sem token de push-to-start (iOS < 17.2, Live Activities nunca registradas) recebe direto o push comum. Duplicado só acontece se a confirmação se perder depois de o card abrir, o que é aceito.

### Respostas concorrentes

Com dois moradores tocando no card, **a primeira resposta vale**; a segunda é recusada (o aparelho dela passa a mostrar "respondido por X"). O caminho de Pessoas/Visitas já faz isso (`assertPedidoPendente`). O caminho antigo (`autorizar`/`negar` em `visitantes.service.ts` ~4772/4824) hoje aceita a segunda resposta e sobrescreve a primeira (um "negar" atrasado tira o acesso já dado): **aplicar a mesma trava no caminho antigo**. *(Decisão minha; não há dados reais, e alinha os dois caminhos.)* Não se sabe se `PESSOAS_MIGRATION_ENABLED` está ligado no EB de produção (sem credencial AWS nesta máquina); os ganchos valem para os dois caminhos de qualquer forma.

### Botões

- **NEGAR** funciona sem desbloquear.
- **AUTORIZAR exige desbloqueio** (Face ID/Touch ID/senha no iPhone; digital/PIN no Android). Decisão do usuário.
- Ambos chamam os endpoints que já existem (`POST /visitantes/:id/autorizar` e `/:id/negar`, mesmo escopo `assertPodeAcessarVisitante`), com a sessão do app. Sem sessão válida, o botão abre o app na tela Solicitações.
- Tocar no corpo do card abre o app na tela **Solicitações** (`PendentesVisitantePage`), como o push atual.
- A resposta atualiza o card **de quem tocou** imediatamente (sem esperar o push) e os demais aparelhos pelo push do servidor.

### App aberto

Com o app em primeiro plano o diálogo atual (`mostrarDialogoAutorizacaoVisitante`) continua aparecendo. O card também existe; ao responder por um, o outro se atualiza.

## 5. Abordagem escolhida e alternativas

**Escolhida — B: ponte nativa em Swift (sem plugin) + extensão iOS em SwiftUI + servidor falando direto com a Apple (APNs) + notificação fixa no Android.** *(Trocada da A em 13/11: o plugin `live_activities` 2.6.0 guarda os dados do card no UserDefaults do App Group, tem `ContentState` fixo (`appGroupId`, `updateId`) e não tem botões — não serve para card aberto e atualizado pelo servidor com o app fechado. Aprovado pelo usuário.)*

- **iPhone**: Widget Extension nova `CardPortaria` (SwiftUI, ActivityKit, iOS 17.0+) desenha o card e a Ilha a partir do `content-state` que o servidor manda. `CardPortariaAttributes` (nosso) é compilado no app e na extensão. Uma ponte Swift no app (`CardAoVivoBridge`):
  - observa `Activity<CardPortariaAttributes>.pushToStartTokenUpdates` (iOS 17.2+) e registra o token no servidor;
  - observa `activityUpdates` e, para cada card aberto, manda ao servidor o token de atualização — **isso é a confirmação da reserva automática** (feito em Swift puro com URLSession, sem depender do Flutter subir em segundo plano);
  - expõe ao Flutter, pelo canal `prestare/card_ao_vivo`: `definirSessao(token, baseUrl)`, `limparSessao()` (também encerra os cards abertos) e `suportado()`.
  A sessão vai para um item próprio do keychain com acessibilidade *after first unlock*, para o NEGAR funcionar com a tela bloqueada (o `flutter_secure_storage` atual pode exigir aparelho desbloqueado).
- **Botões**: `NegarCardIntent` e `AutorizarCardIntent` (`LiveActivityIntent`, no app e na extensão; o iOS executa no processo do app). AUTORIZAR com `authenticationPolicy = .requiresAuthentication`. Chamam `POST /visitantes/:id/negar|autorizar` e atualizam o card local na hora.
- **Sem App Group**: os botões rodam no processo do app e o conteúdo vem do push; nada é compartilhado com a extensão. Só é preciso um App ID novo (`br.com.clickprestare.app.CardPortaria`) sem capacidades.
- **Projeto Xcode sem Mac**: o alvo da extensão é criado no CI por um script Ruby (`xcodeproj`, que já vem com o fastlane), de forma idempotente, antes do build; o `match` assina os dois bundle ids.
- **Servidor**: abre o card com o app fechado (**push-to-start**, iOS 17.2+), envia as atualizações de fase e o encerramento por APNs (`apns-push-type: liveactivity`, tópico `<bundle>.push-type.liveactivity`). O push comum do Firebase não abre Live Activity com o app fechado de forma confiável.
- **Android**: push de dados (FCM, prioridade alta) com a fase; o app (handler de segundo plano do `firebase_messaging` + `flutter_local_notifications`) monta/atualiza **uma** notificação fixa por pedido (mesmo id), de alta importância. NEGAR roda em segundo plano, sem abrir o app. AUTORIZAR **abre o app** — o Android exige desbloqueio para abrir uma tela com a tela de bloqueio segura — e o app autoriza ao abrir, mostrando o resultado. O formato Android 16 (ProgressStyle) fica para depois.

**A — plugin `live_activities`.** Descartada depois de ler o código do plugin (ver acima).

**C — o app abre o card ao receber o push.** Descartada: com o app fechado o iOS não acorda o app de forma confiável; o card falharia exatamente quando importa.

## 6. Restrições

- **Sem Mac**: o iOS só compila no runner macOS do GitHub (`ios-release.yml`, Xcode 26). Toda verificação visual do card iOS é por **TestFlight em aparelho real**.
- **Assinatura**: a extensão tem bundle id próprio → App ID novo no team `9FD7V97G5V` e perfil no `match` (appstore). Sem App Group (abordagem B), o perfil do app principal não muda. O Fastfile precisa assinar os dois alvos.
- **Versões de iOS**: deployment target do app continua 16.0. Card só em **iOS 17.2+** (push-to-start e botões interativos). Abaixo disso, o aparelho recebe o push comum de hoje, sem mudança.
- **Chave da Apple**: o envio por APNs precisa de uma chave **.p8** (Apple Developer → Keys → APNs), com Key ID e Team ID. **Não cabe nas variáveis do Elastic Beanstalk** (limite de 4096 já estourado antes, ver memória `deploy-eb-falha-silenciosa-env-4096`): guardar no **SSM Parameter Store / Secrets Manager** lido pela role da instância. O deploy não pode ganhar `--option-settings`.
- **Ambiente APNs**: builds de TestFlight/App Store usam o APNs de produção; o token de push-to-start é por instalação.
- **Backend de produção = NestJS** (`click-cond-web/apps/api`). O Express (`click-cond-api`) só existe em dev; espelhar o mínimo para não quebrar o emulador.
- **Dois caminhos de dados**: todo ponto do fluxo tem a versão antiga (`Visitantes`) e a de Pessoas/Visitas (`*ViaPessoasVisitas`, ativada por `pessoasMigrationEnabled`). Os ganchos do card valem para os dois.
- **Migração SQL** aplicada à mão no RDS (CloudShell + túnel SSM) **antes** do push, e conferida; push em `master` e `main`.
- **Sem dados reais ainda**: dá para mudar schema sem migração de dados.

## 7. Partes do sistema afetadas

**Servidor (NestJS)**
- Tabela nova para tokens de Live Activity: token de **push-to-start** por aparelho (ligado a `Users_Devices`/usuário) e token de **atualização** por card (aparelho + pedido). Remover no logout, na exclusão de conta e quando o APNs responder token inválido (410).
- Rotas para o app registrar/remover esses tokens (no padrão mobile do NestJS).
- Serviço de envio APNs (HTTP/2, JWT ES256 com a .p8, renovação do JWT, tratamento de 410/400).
- Ganchos de fase, nos dois caminhos de dados: `solicitarAutorizacao` (abre), `autorizar`, `negar`, `checkIn`, `liberarAcesso`, entrada pelo **facial** (webhook que grava `Acessos_Facial`), `checkOut`, exclusão do visitante.
- **Tique de expiração** no padrão do projeto (`setInterval` + `executarComLock`), de ~30 s: encerra cards AGUARDANDO após 3 min e LIBERADO após 10 min. Hoje não existe nenhuma expiração no servidor para o card.
- `notificarMoradoresAutorizacao`: manda o card a quem tem como recebê-lo e aplica a **reserva automática** (seção 4): confirmação por aparelho, push comum após ~10 s sem confirmação. A espera de 10 s não pode bloquear a resposta HTTP do `solicitarAutorizacao`. O facial grava `data_entrada` direto na visita (`facial.service.ts` ~5995/6003): é ali o gancho do ENTROU pelo facial.
- Trava de "pedido ainda pendente" no `autorizar`/`negar` do caminho antigo (seção 4).

**App Flutter**
- Canal `prestare/card_ao_vivo`: chamar `definirSessao` ao logar/abrir com sessão e `limparSessao` no logout (junto de `desregistrarNoServidor`). No logout, o servidor também apaga os tokens de card do usuário.
- Android: `flutter_local_notifications`, canal de alta importância, notificação fixa por pedido, NEGAR em segundo plano, AUTORIZAR abrindo o app; confirmação ao servidor depois de exibir.

**iOS nativo**
- Alvo Widget Extension (SwiftUI): layouts da tela de bloqueio, Ilha expandida, recolhida e mínima, nas fases da tabela.
- Fontes Barlow / Barlow Condensed embutidas na extensão; logo Prestare como asset vetorial.
- `LiveActivityIntent` para NEGAR e AUTORIZAR.

## 8. Riscos conhecidos

- **"Entrou" pelo facial**: `Acessos_Facial.id_pessoa` não tem espaço de id único (comentários em `visitantes.service.ts` ~3534/3565 e `acesso-facial-visitante-lookup.util.ts`). Se a resolução falhar, o card fica em LIBERADO até os 10 min. Usar o mesmo resolvedor que o resto do código já usa; não criar outro.
- **Limites da Apple**: atualizações frequentes de Live Activity são limitadas pelo iOS; o fluxo tem poucas (≤ 4 por pedido), dentro do razoável. Usar `apns-priority` 10 só nas que exigem alerta (início, resolvido por outro).
- **Card de 8 horas**: o iOS encerra Live Activities após 8 h; irrelevante aqui (máximo ~20 min).
- **Logout com card aberto**: encerrar localmente e no servidor.

## 9. Testes

- **API (Jest, `apps/api`)**: transições de fase nos dois caminhos de dados, destinatários (só moradores do apartamento com `notif_visitantes`), expiração (3 min / 10 min), override da portaria, re-solicitação, primeira resposta vale (segunda recusada, nos dois caminhos), reserva automática (com e sem confirmação), token inválido removido, logout remove tokens. Envio APNs com cliente falso.
- **Android**: emulador — notificação fixa, ações, atualização por fase, exigência de desbloqueio.
- **iOS**: TestFlight em iPhone com iOS 17.2+ — app fechado, tela bloqueada, Ilha, botões, desbloqueio no AUTORIZAR, dois aparelhos no mesmo apartamento.

## 10. Deixado para quem for construir

- Nomes de tabelas, colunas e rotas novas.
- Escolha entre `flutter_local_notifications` e canal nativo no Android, e quanto do formato Android 16 entra (desde que o comportamento acima se mantenha).
- Estrutura interna do serviço APNs e onde guardar a .p8 (SSM ou Secrets Manager).
- Layout exato da Ilha **mínima** (quando há duas Live Activities de apps diferentes): sugestão, só o logo.
- Copiar os textos exatamente como na tabela da seção 3.

## 11. Apple Developer: identificadores, App Group e chave APNs

Decisão do usuário: **automático pelo CI**. Com a abordagem B não há App Group: basta o App ID da extensão, e o `match` cria o perfil dela (o do app principal não muda).

Se não tiver (ou para criar a chave **APNs .p8**, que o CI não cria), o usuário **autorizou que eu acesse o Apple Developer pelo navegador** (Playwright) e habilite o que for preciso. A .p8 baixada vai direto para o SSM/Secrets Manager, nunca para o chat nem para o repositório.

Risco da transição: um alvo novo no projeto pode quebrar o build do TestFlight; o script que cria o alvo é idempotente e o build é conferido antes de considerar a publicação feita.
