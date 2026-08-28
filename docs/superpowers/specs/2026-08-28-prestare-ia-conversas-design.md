# PRESTARE IA — conversas, voz e teclado

Data: 28/08/2026

## Problema

A tela do assistente (`chat_ia_page.dart`) hoje:

- Perde a conversa ao fechar: as mensagens vivem só na memória do `State`. O
  backend, porém, continua alimentando o modelo com os últimos 12 turnos
  gravados — a tela abre vazia enquanto o modelo "lembra". A incoerência é
  visível para quem usa.
- Não separa conversas. `Chat_Ia_Historico` é um log corrido por
  `(id_condominio, id_user)`, então uma pergunta sobre boleto herda o contexto
  de uma conversa sobre assembleia de semanas atrás.
- Só aceita texto digitado.
- No iOS não oferece jeito de fechar o teclado: o campo não perde o foco ao
  enviar e a lista de mensagens não dispensa o teclado ao arrastar.

E o assistente passa a se chamar **PRESTARE IA** (feito: commit `fcfab1d`).

## Escopo

1. Histórico de conversas separadas, com lateral para abrir, continuar e apagar.
2. Ditado por voz no campo de perguntar.
3. Correção do teclado no iOS.
4. Pré-perguntas preservadas, em toda conversa vazia.

Fora de escopo: busca dentro do histórico, renomear conversa, paginação,
compartilhar conversa, sincronizar rascunho entre aparelhos.

## Dados

`Chat_Ia_Historico` ganha duas colunas e um índice:

```sql
ALTER TABLE Chat_Ia_Historico
  ADD COLUMN conversa_id CHAR(36) NULL,
  ADD COLUMN titulo VARCHAR(120) NULL,
  ADD INDEX idx_chatia_conversa (id_condominio, id_user, conversa_id);
```

`conversa_id` é um UUID gerado pelo backend. `titulo` é gravado só na primeira
linha da conversa (a primeira pergunta do usuário, truncada em 120), e as
demais linhas ficam com `NULL` — a listagem usa `MAX(titulo)` do grupo.

**Backfill.** As linhas já existentes ficariam sem conversa e sumiriam da
lateral. Cada par `(id_condominio, id_user)` recebe um UUID único e o título
`Conversas anteriores`, preservando o que já foi conversado como uma única
conversa antiga.

Migração aplicada à mão no MySQL de produção antes do deploy — o Railway não
migra sozinho.

## Backend (NestJS, `chat-ia`)

Todo endpoint escopa por `id_user` + `id_condominio` **do JWT**. O
`conversa_id` que o app envia é sempre revalidado contra esse escopo antes de
ler ou apagar: o cliente escolhe qual conversa, nunca de quem.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/chat-ia/conversas?id_condominio=` | `[{ conversa_id, titulo, ultima_em, total }]`, 50 mais recentes |
| GET | `/chat-ia/conversas/:id?id_condominio=` | `[{ papel, mensagem, created_at }]` em ordem |
| DELETE | `/chat-ia/conversas/:id?id_condominio=` | `{ ok: true }` |

`POST /chat-ia/perguntar` passa a aceitar `conversa_id` opcional:

- ausente → o service gera um UUID novo, grava o título a partir da pergunta e
  devolve `conversa_id` na resposta;
- presente e pertencente ao usuário → continua a conversa;
- presente e de outro usuário (ou inexistente) → tratado como ausente, isto é,
  abre conversa nova. Não vaza a existência da conversa alheia.

`getHistoricoRecente` passa a filtrar por `conversa_id`, mantendo o limite de
12 turnos. É o que corrige o vazamento de contexto entre assuntos.

Cards de ação (`propor_*`) não mudam: a proposta continua vivendo no
`AcaoPendenteStore` em memória, com a dívida já conhecida de expirar no deploy.

## App

**Lateral (`drawer`).** Ícone de conversas na AppBar, à esquerda, junto ao
voltar. A lateral lista as conversas por título e data, com "Nova conversa" no
topo e deslizar para apagar. Abrir uma conversa carrega as mensagens pelo GET e
passa a enviar com aquele `conversa_id`.

**Estado.** `_conversaId` no `State`: `null` significa conversa nova ainda não
gravada. A primeira resposta devolve o id, que passa a ser usado nas seguintes.
A lista da lateral é recarregada ao abrir a gaveta, não a cada mensagem.

**Pré-perguntas.** Continuam adaptadas ao papel (síndico vs morador) e passam a
aparecer sempre que a conversa aberta está vazia — inclusive em toda "Nova
conversa", não só na primeira abertura da tela.

**Voz.** Pacote `speech_to_text`: o reconhecimento roda no aparelho, o texto
parcial cai no campo enquanto se fala e o envio continua sendo manual — o
usuário revisa antes de mandar, o que importa num assistente que executa ações.
Botão de microfone à esquerda do botão de enviar, com estado visível de escuta.
Permissão negada não quebra nada: aviso curto e o campo segue por digitação.

Permissões novas: `RECORD_AUDIO` (Android), `NSMicrophoneUsageDescription` e
`NSSpeechRecognitionUsageDescription` (iOS). **Isso tem consequência de
compliance**: permissões de mídia foram removidas do app por causa da Play
Store, e microfone é permissão sensível — exige atualizar Data Safety e a
política de privacidade no Console. Ação do dono da conta, não do código.

**Teclado.** Três ajustes: `unfocus()` após cada envio (inclusive pelas
pré-perguntas), `keyboardDismissBehavior: onDrag` na lista de mensagens e
`textInputAction: send` no campo.

## Erros

Falha ao listar conversas mostra estado de erro com "tentar de novo" dentro da
lateral; o chat continua utilizável. Falha ao carregar uma conversa volta para
a conversa atual com aviso. Apagar pede confirmação e é otimista na lista, com
recuo se o servidor recusar.

## Testes

Backend (`chat-ia.historico.spec.ts` e novo `chat-ia.conversas.spec.ts`):

- usuário A não lê nem apaga conversa do usuário B;
- `conversa_id` de outro usuário em `perguntar` abre conversa nova em vez de
  continuar a alheia;
- `getHistoricoRecente` devolve só os turnos da conversa pedida;
- o título é gravado uma vez, na primeira linha.

App: validação manual no emulador Android (lateral, pré-perguntas, teclado) e
no iPhone (voz e teclado), já que ditado e teclado do iOS não são reproduzíveis
no emulador Android.
