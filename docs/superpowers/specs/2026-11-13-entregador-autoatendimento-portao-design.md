# Entregador: autoatendimento no portão — desenho

Data: 13/11/2026 · Projeto 2 de 3. Independente do projeto 1 (QR dinâmico), exceto por um ponto compartilhado, indicado em "Abertura".

## Intenção

Deixar o entregador entrar sem depender do porteiro, com o morador decidindo e com registro de quem entrou.

O módulo de delivery já avisa, autoriza e acompanha. O que falta é a ligação com o portão: hoje, depois que o morador autoriza, quem abre é o porteiro. Isso não serve para condomínio sem porteiro ou com portaria remota, e vira fila na guarita onde o entregador sobe.

## Objetivos

- O entregador chega, aponta a câmera para um QR fixo no portão, informa a unidade, tira uma selfie e pede a entrada.
- O morador recebe o card ao vivo com a foto e responde na tela de bloqueio.
- Autorizado, **aquele** portão abre, uma vez, dentro de poucos minutos.
- A foto, o portão e os horários ficam no atendimento de delivery.
- Nada disso exige leitor de QR, cadastro prévio do entregador ou o telefone dele.

## Fora do escopo

- Liberação automática sem perguntar ao morador (pedido pré-autorizado). É o passo seguinte natural; fica anotado.
- Link com QR enviado ao entregador (caminho A, descartado).
- Reconhecimento do rosto do entregador. A selfie é só registro.
- Bloqueio de entregador por identidade neste fluxo (não há identidade estável sem cadastro).
- Mudança no cadastro de entregadores e veículos.

## O que seria um fracasso mesmo funcionando

- Portão abrindo sem ninguém na frente, porque o morador respondeu tarde.
- Qualquer pessoa conseguir incomodar moradores em série pelo QR do portão.
- A página pública mostrar nome de morador ou quem mora em qual unidade.
- A foto do entregador acessível por URL pública.

## Restrições

- O card ao vivo do delivery já está no `master` (1241eb15). Este projeto parte de `origin/master`, no branch `feat/acesso-celular`.
- O visual do card é estritamente Prestare Dark.
- Não existe entidade "portão": o portão é o `Facial_Devices` que abre (`botoeira`, `catraca`, ou o próprio terminal `facial`).
- O delivery tem controller próprio (`apps/api/src/app/delivery`) e máquina de estados em `delivery.service.ts` (`TRANSICOES`).
- Fotos vão para o bucket S3 privado da API, servidas pelo interceptor de arquivos privados.
- Produção é o NestJS; schema por SQL manual idempotente aplicado antes do push; POST do app com `@HttpCode(200)`.

## Caminhos considerados

| Caminho | Como funciona | Por que sim ou não |
|---|---|---|
| A. Link com QR para o entregador | O entregador recebe um passe e mostra no leitor | Exige leitor de QR e o telefone do entregador antes da chegada, o que quase nunca existe |
| B. QR fixo no portão | O entregador lê o QR, se identifica com selfie, o morador autoriza e a nuvem abre | Sem hardware novo, sem telefone, foto natural no fluxo |

Escolhido pelo dono do produto: **B**.

## Desenho

### QR do portão

- Em `Facial_Devices`, coluna nova `token_entrega` (aleatório, único). Ter token significa que o aparelho aceita autoatendimento de entrega.
- Na portaria-web, na tela do aparelho: "Gerar QR de entregas", que cria o token e abre uma folha para imprimir (QR, nome do condomínio, "Entregas: aponte a câmera aqui"). "Gerar novo" troca o token e invalida a folha antiga.
- O QR aponta para `…/entrega/<token>`.

### Página do entregador

Rota pública na portaria-web (`entrega/:token`), pensada para celular:

1. Mostra o condomínio e o nome do portão.
2. Unidade: bloco e apartamento, escolhidos de uma lista só com números. Nenhum nome.
3. Nome do entregador e plataforma (iFood, Mercado Livre, outra).
4. Selfie obrigatória pela câmera frontal, com aviso curto de que a foto será mostrada ao morador e guardada pelo condomínio.
5. Enviar. A página passa a mostrar a situação e consulta a API a cada poucos segundos:
   - "Aguardando o morador"
   - "Liberado" (o portão abre, ver Abertura)
   - "O morador vai buscar na portaria"
   - "Não autorizado"
   - "Sem resposta" depois de 60 s, com orientação de procurar a portaria ou o interfone

### Atendimento

`POST /api/entrega/publico/:token` (`@Public`, `@Throttle`, `@SkipAudit`):

- Se a unidade tem atendimento em aberto ainda não chegado (um aviso `AGENDADA` do morador), usa esse, sem conferência: o morador vê a selfie e decide de qualquer forma. Senão cria um.
- Leva o atendimento a `CHEGOU` e daí a `AGUARDANDO_AUTORIZACAO` (`CHEGOU` abre o card, `AGUARDANDO_AUTORIZACAO` mostra os botões), pelas transições existentes em `delivery.service.ts:36-45`. O card é aberto uma vez só, já na fase de pedido de autorização.

Cada página aberta por um entregador é um **pedido de portão**, em tabela própria `DeliveryPedidosPortao`, e não colunas no atendimento. Assim a selfie, o portão e o token nunca se misturam entre duas pessoas.

| Coluna | Uso |
|---|---|
| `id_atendimento` | atendimento a que pertence |
| `id_device` | o aparelho do QR lido |
| `nome`, `plataforma` | informados na página |
| `foto` | chave do arquivo no S3 privado |
| `token_hash` | identifica a página nas consultas |
| `status` | `pendente`, `liberado`, `vou_buscar`, `recusado`, `expirado` |
| `visto_em` | última consulta da página (presença) |
| `liberado_ate` | fim da janela de abertura |
| `aberto_em`, `saida_aberta_em` | quando o portão abriu |
| `criado_em`, `expira_em` | `expira_em` = criação + 5 minutos |

Em `DeliveryAtendimentos`: `origem` (`portaria`, padrão atual, ou `autoatendimento`), `id_pedido_portao` (o pedido ativo) e `id_morador_user` passa a aceitar nulo.

Regras do pedido:

- **Mesma pessoa reabrindo.** A página guarda o token no navegador; ler o QR de novo retoma o mesmo pedido enquanto ele não expirou.
- **Outra pessoa, ou outro portão, para a mesma unidade com pedido pendente.** É recusada com "Já há uma entrega aguardando esta unidade. Tente em alguns minutos." Nunca substitui selfie ou portão: o portão que abre é sempre o do pedido cuja selfie o morador viu.
- **Sem resposta em 5 minutos.** O pedido vira `expirado`. Um pedido novo para a unidade volta a ser aceito, entra no mesmo atendimento se ele ainda estiver aberto, e toca o morador de novo com card novo. O "Sem resposta" dos 60 segundos é só o texto da página.
- **Atendimento criado pelo autoatendimento e sem resposta por 2 horas** (o mesmo prazo em que o card some): vai a `CANCELADA` com motivo "Sem resposta do morador" e autor sistema, por rotina horária no padrão da API (`setInterval` com `executarComLock`). O aviso `AGENDADA` criado pelo morador não é cancelado por essa rotina.

Cada passo grava em `DeliveryEventos`, como já acontece.

### Quem recebe e quem responde

- Atendimento que nasceu de um aviso do morador: como o master já faz. O card vai para quem criou o aviso (`id_morador_user`), os outros moradores da unidade recebem a notificação comum do pedido de autorização, e qualquer morador com vínculo na unidade pode responder (`delivery.service.ts:263-268`, `notificarOutrosDaUnidade`).
- Atendimento criado pelo autoatendimento: o card vai para todos os usuários ligados ao apartamento em `Apartamentos_Users`, de qualquer tipo de vínculo. O núcleo do card já aceita vários usuários (`card-ao-vivo.service.ts`, `idsUsuarios`). O primeiro que responde vira o dono (`id_morador_user`); para os outros o card fecha. Na lista do app o atendimento continua visível aos moradores da unidade com o desfecho, que é a regra atual do master (`delivery.service.ts:175-178`).

### Conclusão sem porteiro

Hoje só a portaria conclui (`AUTORIZADA → CONCLUIDA`). Para atendimento com pedido de portão liberado, o sistema conclui sozinho, com autor sistema, no que vier primeiro: a abertura de saída, ou 30 minutos depois da abertura de entrada (na mesma rotina horária, e também ao consultar). A portaria continua podendo concluir antes.

### Resposta do morador

O card ao vivo e a tela do app mostram a selfie (no lugar da foto de cadastro, que não existe neste fluxo), nome, plataforma e portão.

Respostas, **só para atendimento com pedido de portão ativo**:

- **Liberar entrada** → `AUTORIZADA`; segue para Abertura.
- **Vou buscar** → `RETIRADA_NA_PORTARIA`, estado que já existe; o portão não abre e a página avisa o entregador. Hoje o morador só pode responder `AUTORIZADA` ou `RECUSADA` (`delivery.service.ts:263-268`); essa terceira resposta é liberada apenas para este caso.
- **Recusar** → `RECUSADA`, na tela do app, fora do card, com o motivo que a regra atual exige.

As duas primeiras são oferecidas mesmo quando o aviso original dizia `modo_entrega = PORTARIA`: o morador pode mudar de ideia.

O card dos outros deliveries **não muda**: continua RECUSAR / AUTORIZAR, como aprovado no desenho do card. O estado do card ganha um campo opcional que liga a variante "VOU BUSCAR / LIBERAR ENTRADA". Versão do app que não conhece o campo mostra o card normal, e AUTORIZAR vale como liberar entrada: a funcionalidade funciona com o app que já está publicado, e fica completa com o app novo.

**Porteiro.** Se o condomínio tem porteiro, o atendimento aparece na fila da portaria-web como qualquer outro, com a selfie. Se o porteiro autorizar por lá, a nuvem **não** abre nada e a janela de 3 minutos não se aplica: ele abre pelo meio de hoje. Para atendimento de origem `autoatendimento`, a exigência de entregador cadastrado na autorização feita pela portaria (`delivery.service.ts:280-282`; a do morador já é dispensada no master) deixa de valer; nome e selfie vêm do pedido. A mesma regra existe na tela (`delivery.store.ts`, `podeAutorizar`) e é ajustada junto.

### Abertura

Quando **o morador** responde "Liberar entrada" num atendimento com pedido de portão ativo:

- `liberado_ate` = agora + 3 minutos.
- Se a página do entregador consultou a API nos últimos 10 segundos, a nuvem abre o aparelho do pedido (`id_device`) imediatamente.
- Se não, a página mostra o botão "Abrir portão" quando voltar, válido até `liberado_ate`.
- Abre uma vez. `aberto_em` preenchido encerra a janela.

Saída: depois de entrar, a página oferece "Abrir para sair", uma vez, até 30 minutos após a entrada, no mesmo aparelho. Em portão com botão de saída do lado de dentro, o entregador nem precisa usar.

A abertura usa `triggerRelay` (agente se online, HTTP direto como reserva), que não olha o tipo do aparelho; a recusa a aparelho `facial` existe só na rota manual do porteiro. A abertura decidida pela nuvem é um método novo do `FacialService`, compartilhado com o projeto 1, que chama `triggerRelay` e `registrarEvento` como a ponte leitor → abertura já faz:

```ts
abrirDispositivoInterno(
  idDevice: number,
  ctx: {
    origem: 'credencial_qr' | 'delivery_portao';
    tipoPessoa: string;
    idPessoa?: number | null;
    nomePessoa: string;
    credencial?: string | null; // vai para face_id; nunca o código lido
  },
): Promise<{ ok: boolean; erro?: string }>
```

Grava `acionado_auto` quando abre e `falha_acionamento` quando não. Quem for implementado primeiro cria o método; o outro reutiliza.

Cada abertura grava em `Acessos_Facial` um evento `acionado_auto` com tipo de pessoa `entregador` e o nome informado.

### Proteções

- Opção por condomínio "Autoatendimento de entregas", desligada por padrão, com horário de funcionamento (início e fim). Fora do horário a página informa e não chama ninguém.
- Limite por IP e por portão na página pública.
- Uma unidade com pedido pendente não recebe outro card: o segundo pedido é recusado até o primeiro ser respondido ou expirar.
- A página só consegue consultar e abrir o pedido que ela mesma criou, pelo token.
- O limite por IP usa o IP real do cliente; a API já roda com `trust proxy` 3, medido em produção (`main.ts`).

### Foto

- Guardada no S3 privado, ligada ao atendimento.
- Aparece no card, no detalhe do app, na fila e no histórico da portaria-web.
- Apagada 90 dias depois do atendimento.

## Erros e casos de borda

- Agente offline e HTTP direto falhando: a página mostra "Não foi possível abrir, procure a portaria"; o atendimento continua autorizado e registra a falha (`falha_acionamento`).
- Morador responde depois de 60 s: a resposta vale; a página, se ainda aberta, atualiza.
- Entregador fecha a página: sem presença, nada abre sozinho; ao ler o QR de novo no mesmo celular ele retoma o mesmo pedido enquanto não expirou (o token fica no navegador).
- Morador responde "Liberar entrada" depois de o pedido expirar (5 minutos): o atendimento vai a `AUTORIZADA`, mas nada abre e nenhuma janela é criada. Se o entregador ainda estiver lá, um pedido novo cria outro atendimento e toca o morador de novo.
- Atendimento do autoatendimento que ficou em `AUTORIZADA` sem abertura, ou em `RETIRADA_NA_PORTARIA`, sem porteiro para concluir: a rotina conclui 2 horas depois da resposta, com autor sistema.
- Unidade sem morador com app: a página informa "Sem resposta"; o porteiro, se houver, vê na fila.
- Token do portão trocado: a página antiga informa que o QR não vale mais.

## Testes

- Criação e reaproveitamento de atendimento por unidade.
- Abertura imediata com presença; botão sem presença; janela vencida; segunda abertura recusada; saída única.
- Aparelho errado nunca abre: a abertura usa só o `id_device` do pedido.
- Condomínio com a opção desligada e fora do horário.
- Página pública não devolve nome de morador em nenhuma resposta.
- Token de acompanhamento de um atendimento não lê nem abre outro.

## Decisões minhas (não vieram do dono do produto)

- Três respostas para o morador, com "Vou buscar" no card e "Recusar" só no app.
- Abertura imediata só com a página presente; senão, botão por 3 minutos.
- Saída única em até 30 minutos.
- "Sem resposta" aos 60 segundos.
- Foto apagada em 90 dias.
- Horário de funcionamento por condomínio.
- Opção desligada por padrão.
- Pedido de portão em tabela própria; segunda pessoa para a mesma unidade é recusada, nunca substitui.
- Pedido expira em 5 minutos; atendimento do autoatendimento sem resposta é cancelado em 2 horas.
- Conclusão automática na saída ou 30 minutos após a entrada.
- Atendimento do autoatendimento toca todos os vínculos do apartamento; aviso do morador toca só o dono.
- Autorização feita pelo porteiro não abre o portão pela nuvem.
- Variante de botões só neste fluxo; app antigo continua funcionando com AUTORIZAR.

## Deixado ao implementador

- Estados exatos a usar na máquina do delivery, conforme `TRANSICOES`.
- Como os botões do card do iPhone e da notificação do Android acomodam "Vou buscar", dentro do Prestare Dark.
- Limites exatos de `@Throttle`.
- Compressão da selfie antes do envio.
- Rotina que apaga as fotos vencidas.
