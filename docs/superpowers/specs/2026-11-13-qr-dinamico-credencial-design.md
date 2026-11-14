# QR Code dinâmico como credencial de acesso — desenho

Data: 13/11/2026 · Projeto 1 de 3 (os outros dois, passe de entregador e Wallet, têm desenho próprio e se apoiam neste).

## Intenção

Dar ao morador e ao visitante uma forma de entrar pelo celular que não seja o rosto e que não possa ser repassada por print.

Motivos:

- A LGPD e decisões recentes exigem alternativa ao reconhecimento facial. Hoje a alternativa é o PIN de 6 dígitos.
- O PIN é fixo durante a visita. O QR que o app mostra hoje é o próprio PIN desenhado, então um print vale tanto quanto o original.
- O envio por WhatsApp monta a imagem do QR em `api.qrserver.com`, ou seja, o PIN passa por um terceiro.
- O morador tem a coluna `Moradores.qrcode_acesso`, mas o app não mostra nada.

## Objetivos

- Morador abre o portão mostrando no app um QR que muda a cada 30 segundos.
- Visitante abre o portão com um link que mostra o QR girando, sem instalar nada.
- Um print do QR deixa de abrir em no máximo 90 segundos, e não abre duas vezes no mesmo leitor.
- O PIN não sai mais da Prestare para gerar imagem.
- Da leitura até o portão abrir: meta de 3 segundos em condição normal. É meta, não critério de aceite: mede-se na bancada e o número medido entra no relatório. O agente busca comandos a cada 2 s (`agent/src/index.js:112`), o que sozinho pode consumir a meta; trocar o transporte do agente não faz parte deste projeto.

## Fora do escopo

- Validação sem internet no condomínio (o agente local validar sozinho). É a etapa seguinte.
- Encostar o celular (NFC) e passe na Wallet (projeto 3).
- Passe de entregador (projeto 2).
- QR lido no próprio terminal Hikvision ou Control iD. Para essas marcas vale só o leitor avulso.
- Retirar o PIN. Ele continua para o porteiro validar digitando.
- Credencial para síndico que não é morador e para quem está na tabela `Funcionarios` (o webhook não resolve essa tabela hoje).
- O QR de login da portaria-web, que também usa `api.qrserver.com`. Anotar como pendência separada.

## O que seria um fracasso mesmo funcionando

- Credencial revogada, ou de visita encerrada, que ainda abre.
- Morador sem rosto cadastrado que fica sem entrar porque o QR falhou e não havia outro meio.
- Segredo da credencial em log, em `Acessos_Facial` ou em serviço de terceiro.
- Espera perceptível no portão a ponto de o morador voltar a preferir o rosto.

## Restrições

- Produção é o NestJS (`click-cond-web/apps/api`). O Express só existe em dev.
- Mudança de schema é SQL manual idempotente em `click-cond-web/prisma/manual_AAAA-MM_<nome>.sql`, aplicada no RDS antes do push.
- O app só trata HTTP 200: todo POST leva `@HttpCode(200)`.
- O terminal Dahua/Intelbras decide localmente e o agente só encaminha evento de rosto (`Code=_DoorFace_`, `agent/src/drivers/dahua-facial.js:684-702`). Eventos com `ErrorCode≠0` são descartados em `agent/src/index.js:972`.
- `triggerDevice` recusa abrir aparelho do tipo `facial` (`facial.service.ts:1818`), embora o driver saiba abrir.
- O conteúdo do QR precisa ser curto: leitores baratos leem mal QR denso, e o terminal Dahua pode tratar o conteúdo como número de cartão com limite de tamanho.

## Caminhos considerados

| Caminho | Como funciona | Custo |
|---|---|---|
| A. Código rotativo validado na nuvem | O app gera o código a partir de um segredo; o leitor envia o que leu; a nuvem confere e manda abrir | Depende de internet no condomínio |
| B. Código fixo gravado no terminal | O QR carrega um número de cartão cadastrado no aparelho | Funciona offline, mas print vale para sempre |
| C. A com validação também no agente | Igual a A, com os segredos sincronizados no agente | Resolve a queda de internet; dobra o trabalho |

Escolhido: **A**, por decisão delegada pelo dono do produto. B mantém o defeito que motivou o projeto. C fica como etapa seguinte, e o formato do código já é pensado para ela (a validação não depende de consulta ao banco além do segredo).

## Desenho

### Credencial

Tabela nova `Credenciais_Acesso`:

| Coluna | Uso |
|---|---|
| `id` | inteiro, entra no código |
| `id_condominio` | escopo |
| `tipo_pessoa`, `id_pessoa` | `morador` (com `id_pessoa` = `Moradores.id`, inclusive as linhas de tipo funcionário que vivem nessa tabela) ou `visita` (visitante e prestador são a mesma linha de visita, com `is_prestador`; `id_pessoa` fica nulo) |
| `id_visita`, `id_visitante` | um dos dois, conforme a modelagem em uso (ver abaixo) |
| `segredo` | 32 bytes aleatórios |
| `origem` | `app` ou `link` (os projetos 2 e 3 acrescentam valores) |
| `versao_link` | inteiro; muda para invalidar o link do visitante |
| `valido_de`, `valido_ate` | opcionais; a visita já tem janela própria |
| `revogada_em` | revogação |
| `criado_em` | |

Uma credencial ativa por pessoa, condomínio e origem. Abrir o app em outro aparelho gera segredo novo e mata o anterior.

**Quem é a pessoa do morador.** O token do app carrega `Users.id`, e um usuário pode ter várias linhas em `Moradores` (mais de um apartamento ou condomínio). A rota de emissão recebe o `id_condominio` que o app está mostrando e usa a linha ativa de `Moradores` daquele usuário naquele condomínio; havendo mais de uma, a primeira. Um usuário em dois condomínios tem duas credenciais.

**Visita nas duas modelagens.** O projeto convive com `PESSOAS_MIGRATION_ENABLED` ligada (`Visitas`) e desligada (`Visitantes`), e o valor em produção não está confirmado no repositório. A credencial de visita aponta para `id_visita` ou `id_visitante` e segue o mesmo despacho duplo que `runWebhook` já faz. Se o dono do produto confirmar que a flag está ligada em produção, o ramo `Visitantes` pode ser dispensado.

**Revogação.** A credencial de visita só vale enquanto a linha da visita mantém `codigo_acesso` preenchido. Todos os pontos que hoje anulam o PIN (saída por leitor de QR em `facial.service.ts:6165, 6178`; `mobile-auth.service.ts:6258, 6265`; `visita-passagem.util.ts:36, 76`; `vagas.service.ts:399, 406`) revogam a credencial sem precisar de alteração, porque a validação confere a visita a cada leitura. A do morador deixa de valer quando a linha de `Moradores` some ou muda de condomínio; a validação também confere isso a cada leitura. Revogação explícita (`revogada_em`) fica para a troca de aparelho e para a invalidação do link.

Tabela `Credenciais_Leituras` (`id_credencial`, `id_device`, `contador`, único nos três): impede que o mesmo código abra duas vezes no mesmo leitor. É por leitor, e não por credencial, porque um caminho de acesso pode ter dois leitores em sequência dentro dos mesmos 30 segundos.

### Formato do código

`P1` + 26 caracteres em base32 (maiúsculas e dígitos), 28 no total:

- 4 bytes: `id` da credencial
- 4 bytes: contador = `floor(unix / 30)`
- 8 bytes: os primeiros 8 bytes de `HMAC-SHA256(segredo, "P1" | id | contador)`

A nuvem aceita o contador atual e os vizinhos (−1 e +1), para absorver relógio adiantado ou atrasado no celular. Na emissão a API devolve a hora do servidor e o app guarda a diferença.

O mesmo cálculo existe em TypeScript (API) e em Dart (app), com vetores de teste compartilhados.

### Validação

Ponto único de entrada: `runWebhook` em `facial.service.ts`, antes da busca atual por `qrcode_acesso` e `codigo_acesso`. Se o valor lido começa com `P1`:

1. Decodifica, busca a credencial, confere condomínio, revogação e validade.
2. Confere o HMAC e a janela do contador.
3. Grava em `Credenciais_Leituras`; violação de unicidade é reuso e vira negado.
4. Resolve a pessoa e entrega ao fluxo que já existe (regras de acesso, janela e dias da visita, ponte leitor → abertura, `registrarEvento`).

Em `Acessos_Facial.face_id` grava `cred:<id>`, nunca o código lido. Falha vira evento `negado`.

Valor que não começa com `P1`:

- `Moradores.qrcode_acesso` e tags estáticas já cadastradas continuam valendo como hoje.
- **PIN de visita ou de prestador lido como QR passa a ser recusado quando o condomínio tem "QR no app" ligada.** Sem esse corte, um print do QR antigo (que é o PIN) continuaria abrindo, e o objetivo do projeto não se cumpriria para o visitante. O PIN segue válido digitado pelo porteiro. Com a opção desligada nada muda. Versões antigas do app, que ainda desenham o PIN como QR, deixam de abrir nesses condomínios; o guia de implantação manda ligar a opção só depois de o app novo estar nas lojas.

Dois vazamentos a fechar no caminho atual, para qualquer valor que comece com `P1` ou `P2`:

- o log de debug do cooldown grava a credencial lida (`facial.service.ts:5148-5150`, e o `Debounce:` de `access-state.service.ts:52-54`);
- o evento `negado` grava o valor lido em `face_id` (`facial.service.ts:5358-5360`), e o log de captura de cadastro o repete (`facial.service.ts:5343-5345`).

Nos dois, gravar `cred:<id>` quando o id for decodificável e `cred:?` quando não for.

### Leitores

**Leitor de QR avulso (`qrcode_reader`).** Já envia a leitura por webhook e já aciona a abertura. Funciona com este desenho sem mudança no aparelho.

**Leitor embutido no terminal Dahua/Intelbras.** Depende de validação em bancada, que é a primeira tarefa do plano:

- o terminal emite evento com o conteúdo lido quando o "cartão" é desconhecido?
- quantos caracteres chegam?
- qual é o `Method` e em que campo vem o conteúdo?

A bancada vem **antes** de qualquer código do formato, porque o formato é compartilhado com o projeto 3 e fica fixado em vetores de teste nas duas linguagens. Três resultados possíveis:

- **Confirma** (conteúdo de 28 caracteres chega inteiro): segue como descrito.
- **Parcial** (chega cortado, ou só aceita dígitos ou hexadecimal): o formato é ajustado antes de ser fixado, mantendo id e contador e encurtando o HMAC até o mínimo de 6 bytes, ou trocando a codificação. Abaixo disso conta como "nega".
- **Nega**, ou não há terminal com leitor de QR disponível para testar: o projeto entrega só com leitor avulso, o formato fica como descrito, e isso é registrado no guia de implantação.

Se a bancada confirmar ou for parcial:

- o agente passa a encaminhar o evento de acesso que não é de rosto, com o conteúdo bruto no campo `qrcode`, inclusive quando `ErrorCode≠0` e o conteúdo começa com `P1` (hoje `agent/src/index.js:972` descarta);
- `processAgentEvent` passa a aceitar evento só com `qrcode` (hoje exige `external_id`, `person_id` ou `placa`, `facial.service.ts:4743-4747`);
- a ponte de abertura, que hoje só roda para tipos leitor (`facial.service.ts:6302-6305`), passa a rodar também quando um terminal `facial` entrega um código `P1` válido, abrindo aquele mesmo terminal por `open_door` na fila do agente (`facial-device-client.service.ts:458`). Essa abertura é interna ao fluxo de validação; a rota manual do porteiro (`triggerDevice`, `facial.service.ts:1818`) não muda. O projeto 2 precisa da mesma função interna e a reutiliza.

Isso exige uma versão nova do agente.

### App (morador)

Tela "Meu acesso":

- QR grande, contagem regressiva de 30 s, brilho da tela no máximo enquanto aberta.
- Gera o código no próprio aparelho; funciona sem internet depois da primeira emissão.
- Segredo no armazenamento seguro do sistema.
- No Android, bloqueio de captura de tela nessa tela.
- Aparece só quando o condomínio tem a opção ligada.

### Visitante

- Na lista de visitantes e na de prestadores de serviço (`list_visitantes.dart`, `list_prestadores.dart`), o QR estático dá lugar a "Compartilhar passe", que gera um link `…/passe/<token>`. As duas listas leem a mesma rota (`/visitantes/get-all`): o prestador é uma visita com `is_prestador`, e usa a mesma rota de link.
- O token é derivado no servidor (`HMAC(chave do servidor, id da credencial | versao_link)`), então pode ser reemitido sem guardar o valor. Mudar `versao_link` invalida o link.
- A página pública (portaria-web, mesmo padrão de `convite/:token`) mostra nome, condomínio, validade e o QR. Ela busca o código atual na API a cada 25 s; o segredo não vai para o navegador.
- A mensagem de WhatsApp leva o link, e não mais a URL de imagem do `api.qrserver.com`.
- O PIN continua na mensagem como alternativa.

Limite conhecido: quem recebe o link pode encaminhá-lo. O ganho sobre hoje é que um print não serve e que o morador pode invalidar o link.

### Rotas

Módulo próprio `credenciais` no NestJS:

- `POST /api/credenciais/minha` — recebe `id_condominio`; emite ou reemite a credencial do morador logado (`UsuarioAppGuard`). Quem não tem linha de morador naquele condomínio recebe uma resposta "sem credencial" que o app trata escondendo a tela.
- `POST /api/credenciais/visita/:id/link` — devolve o link do visitante; só o morador dono da visita ou operador. O `:id` é o mesmo que a lista do app já usa.
- `POST /api/credenciais/visita/:id/invalidar-link`
- `GET /api/passes/publico/:token` — dados e código atual; `@Public`, `@Throttle`, `@SkipAudit`.

### Liga e desliga

Opção por condomínio "QR no app", desligada por padrão. Desligada, o app não mostra a tela e a validação recusa códigos `P1`. Não há tabela de opções: é coluna nova em `Condominios`, como os outros liga/desliga (`schema.prisma:264-277`).

**O outro meio do morador.** O QR depende de internet no condomínio, e morador não tem PIN. Isso não vira funcionalidade nova: a tela da opção avisa o síndico, e o guia de implantação exige, que todo morador sem rosto cadastrado tenha tag ou que haja porteiro, antes de ligar.

## Erros e casos de borda

- Sem internet no condomínio: o QR não abre. Rosto, tag e PIN com o porteiro continuam. A tela do app não precisa saber disso.
- Relógio do celular errado em mais de 30 s além da correção guardada: negado; o app refaz a correção de hora quando tiver internet.
- Morador removido ou visita encerrada: a credencial é revogada no mesmo ponto em que hoje o rosto é removido e o PIN é anulado.
- Muitas tentativas inválidas no mesmo leitor: limite de tentativas, a definir pelo implementador a partir do que o webhook já tem.

## Testes

- Vetores fixos de geração e validação, iguais em TypeScript e Dart.
- Janela do contador, reuso no mesmo leitor, uso em dois leitores seguidos, revogação, condomínio com a opção desligada, credencial de outro condomínio.
- `runWebhook`: código `P1` válido aciona a abertura esperada; valor estático antigo continua funcionando.
- Página pública: token inválido, link invalidado, visita fora da janela.

## Decisões minhas (não vieram do dono do produto)

- Rotação de 30 s com tolerância de um intervalo para cada lado.
- Uma credencial por pessoa; aparelho novo derruba o anterior.
- Anti-reuso por leitor.
- Página do visitante busca o código na API em vez de receber o segredo.
- PIN mantido como alternativa, mas recusado quando lido como QR em condomínio com a opção ligada.
- Bloqueio de captura de tela só no Android (o iOS não permite).
- Opção por condomínio desligada por padrão.
- Credencial só para quem tem linha em `Moradores`; síndico não morador e tabela `Funcionarios` ficam fora.
- Prestador de serviço recebe link como o visitante (mesma rota, mesma linha de visita).
- 3 segundos como meta medida, não como critério de aceite.
- Morador sem rosto fica coberto por regra de implantação (tag ou porteiro), não por funcionalidade nova.
- Bancada antes do código do formato, com ajuste permitido só nesse momento.

## Deixado ao implementador

- Se o segredo fica cifrado no banco, conforme exista ou não um utilitário de cifra no projeto.
- No app, `flutter_secure_storage` e `qr_flutter` já estão no `pubspec.yaml`. Faltam pacotes de brilho de tela e de bloqueio de captura; a escolha é do implementador.
- Limpeza periódica de `Credenciais_Leituras`.
- Limites exatos de `@Throttle`.
- Onde a tela "Meu acesso" entra no menu.
