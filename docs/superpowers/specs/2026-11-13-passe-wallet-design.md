# Passe do morador na Apple Wallet e Google Wallet — desenho

Data: 13/11/2026 · Projeto 3 de 3. Depende do projeto 1 (`2026-11-13-qr-dinamico-credencial-design.md`): usa a tabela de credenciais, o ponto de validação e a tela "Meu acesso".

## Intenção

O morador abre o portão a partir da carteira do celular, sem abrir o app nem estar logado. É conforto para o morador e vitrine para a Prestare.

## Objetivos

- Na tela "Meu acesso", o morador toca em "Adicionar à Carteira" e o passe aparece na Apple Wallet ou na Google Wallet.
- O passe mostra um QR que os mesmos leitores do projeto 1 aceitam.
- O QR do passe troca sozinho uma vez por dia.
- Morador removido, ou passe cancelado, deixa de abrir na hora e o passe aparece como inválido.

## Fora do escopo

- Encostar o celular (NFC). Depende de programa da Apple e de leitor compatível.
- Passe para visitante, prestador ou entregador.
- Abrir pela carteira sem leitor de QR.

## O que seria um fracasso mesmo funcionando

- Passe de ex-morador que continua abrindo.
- O passe enfraquecer a segurança de quem não o usa.
- Certificado ou chave de assinatura no repositório ou em log.
- Passe com visual fora do Prestare Dark.

## Restrições

- Um passe de carteira não gera código a cada 30 segundos: ele só muda quando o servidor manda uma atualização. Por isso o código do passe é diário, e mais fraco que o do app.
- O ambiente do Elastic Beanstalk está no limite de 4096 caracteres de variáveis, e uma atualização acima disso falha em silêncio. Certificados e chaves **não** podem ir em variável de ambiente.
- A API já assume um papel da AWS para o S3, sem chave no ambiente.
- Entitlements do iOS hoje só têm `aps-environment`.
- Dependem do dono do produto, fora do código:
  - Apple: **feito em 14/11/2026.** Pass Type ID `pass.br.com.prestarecondominios.acesso`, team `9FD7V97G5V`, certificado válido até 14/12/2027. Falta subir a chave, o certificado e o intermediário WWDR G4 para o S3 privado.
  - Google: criar a conta de emissor no Google Wallet e uma conta de serviço; pedir acesso de publicação (até a aprovação, só contas de teste conseguem adicionar o passe).

## Caminhos considerados

| Caminho | Como funciona | Por que sim ou não |
|---|---|---|
| A. Passe com QR | Passe assinado pelo servidor, com QR aceito pelos leitores atuais | Barato depois do projeto 1; código diário |
| B. NFC | Encostar o celular no leitor | Aprovação da Apple e hardware novo |

Escolhido pelo dono do produto: **A**.

## Desenho

### Credencial do passe

Uma linha própria em `Credenciais_Acesso` por carteira, com `origem = wallet_apple` ou `wallet_google`, cada uma com segredo separado do segredo do app. Vale a regra do projeto 1: uma credencial ativa por pessoa, condomínio e origem.

"Adicionar" de novo reentrega o mesmo passe, sem criar outro. Sair do app (logout) não cancela o passe.

Assim, cancelar o passe não derruba o QR do app, e o código diário não expõe o segredo do código de 30 segundos.

### Formato do código

`P2` + 26 caracteres em base32, mesma estrutura do `P1`:

- 4 bytes: `id` da credencial
- 4 bytes: contador = número do dia (dias desde 01/01/1970 no fuso de Brasília)
- 8 bytes: início de `HMAC-SHA256(segredo, "P2" | id | contador)`

A validação aceita o dia atual e o anterior, para o celular que ficou sem internet na virada.

O código `P2` **não** entra em `Credenciais_Leituras`: ele é reutilizado o dia inteiro por natureza. É o ponto fraco assumido deste projeto, em dois níveis:

- um print do passe vale até o fim do dia seguinte;
- uma **cópia** do passe (arquivo repassado antes de adicionar, link do Google aberto em outra conta, aparelho antigo) não é um print: ela recebe o código novo todo dia, até o cancelamento.

Compensações: cancelamento imediato pelo morador e pelo operador, opção por condomínio, `sharingProhibited` no passe da Apple (esconde o botão de compartilhar) e restrição a um usuário na classe do Google. Isso reduz o problema, não o elimina, e o texto da opção no console diz isso ao síndico.

### Validação

No mesmo ponto do projeto 1 (`runWebhook`), o prefixo `P2` segue os mesmos passos, sem o anti-reuso, e exige a opção "Passe na carteira" ligada no condomínio.

### Apple Wallet

- Passe do tipo genérico, assinado no servidor com o certificado do Pass Type ID.
- Serviço de atualização de passes no padrão da Apple: registrar aparelho, listar passes alterados, entregar o passe atual, remover registro, receber log.
- Tabela `Wallet_Registros` (aparelho, token de push, credencial do passe) para saber a quem avisar, e a coluna `wallet_atualizado_em` na credencial para responder "quais passes mudaram desde…".
- Das cinco rotas do serviço, três chegam com `Authorization: ApplePass <token>` (registrar, remover registro, entregar o passe). "Listar passes alterados" e "receber log" chegam sem autenticação, só com o identificador do aparelho: a listagem devolve apenas números de série e nada mais.
- Tarefa diária na hora 0 de Brasília, no padrão que a API já usa (`setInterval` de hora em hora com `executarComLock` e `cicloDeNegocio`, `facial.service.ts` e `common/lock-distribuido.ts`; não há `@nestjs/schedule`): avisa os aparelhos registrados; cada um busca o passe com o código do dia. Pode rodar em qualquer minuto entre 00:00 e 00:59; a tolerância de um dia cobre.
- O aviso sai com validade longa, para alcançar o aparelho que estava sem internet. A entrega não é garantida, e o morador pode desligar as atualizações automáticas do passe: nesse caso o passe para de abrir depois da tolerância e volta com atualização manual. O verso do passe explica como atualizar.
- Cancelamento: aviso imediato e passe entregue como inválido.
- O aviso de atualização de passe usa conexão com o certificado do passe e tópico igual ao Pass Type ID. O `ApnsClient` de `card-ao-vivo/apns.client.ts` não serve como está (JWT com chave `.p8`, tipo `liveactivity`); reaproveita-se a parte de HTTP/2, o tratamento de timeout e `tokenMorto`.
- O app **não** consulta nem remove passes da carteira, para não exigir o entitlement `com.apple.developer.pass-type-identifiers` e a regeração dos perfis de provisionamento. Adicionar um passe não precisa dele.

### Google Wallet

- Uma classe de passe genérico por ambiente e um objeto por morador.
- "Adicionar" é um link assinado pela conta de serviço.
- A troca diária é uma atualização do objeto pela API do Google; o celular sincroniza sozinho.
- Cancelamento: objeto marcado como inativo.
- O Android usa `P2`, igual ao iPhone. O código rotativo nativo da Google Wallet **não** é usado: ele exigiria entregar o segredo da credencial ao Google (o que o projeto 1 lista como fracasso) e só gera TOTP decimal padrão, não o formato `P1`.

### Segredos de assinatura

Certificado e chave do passe da Apple e chave da conta de serviço do Google ficam no S3 privado, lidos por `StorageService.lerObjetoTexto` com o papel que a API já tem, do mesmo jeito que a chave do APNs é carregada hoje (`card-ao-vivo/card-ao-vivo.service.ts`). Nada em variável de ambiente, nada no repositório. O SSM em `/prestare/api/` não serve: ele copia tudo para `process.env` no boot.

O número do emissor do Google também fica no S3 (`config/wallet/google/emissor.json`), para não criar variável de ambiente.

Sem os arquivos no S3, a API sobe normalmente e as rotas de carteira respondem "indisponível"; o app esconde os botões. A ausência dos arquivos do Google é a "chave de configuração" que mantém o botão do Android oculto até a conta estar pronta.

### App

Na tela "Meu acesso", abaixo do QR:

- iPhone: botão oficial "Adicionar à Carteira da Apple".
- Android: botão oficial "Adicionar à Carteira do Google".
- Depois de adicionado: situação do passe conforme a credencial no servidor, "Adicionar novamente" sempre disponível, e "Cancelar passe", que revoga a credencial.
- O botão só aparece com a opção do condomínio ligada.

### Cancelamento pelo operador

Celular perdido ou roubado abre o portão pela carteira sem login no app, e no iPhone até com a tela bloqueada. Por isso o operador (síndico ou porteiro) também cancela: na portaria-web, na ficha do morador, "Cancelar passe da carteira", com registro em auditoria. Rota de operador `POST /api/credenciais/wallet/morador/:idMorador/cancelar`.

### Visual do passe

Prestare Dark: fundo escuro, logo da Prestare, nome do condomínio, nome do morador, unidade e o QR. Sem foto, sem CPF.

### Rotas

- `GET /api/credenciais/wallet/situacao` — diz ao app se a opção está ligada, se cada carteira está disponível e se há passe ativo; é por ela que o app decide mostrar os botões.
- `POST /api/credenciais/wallet/apple` — devolve o arquivo do passe (`UsuarioAppGuard`).
- `POST /api/credenciais/wallet/google` — devolve o link de adicionar.
- `POST /api/credenciais/wallet/cancelar`
- Rotas do serviço de atualização da Apple, públicas, autenticadas pelo token que vai dentro do próprio passe.

### Liga e desliga

Opção por condomínio "Passe na carteira", desligada por padrão, e só disponível se "QR no app" estiver ligada.

## Erros e casos de borda

- Celular sem internet por mais de um dia: o passe mostra código vencido e é negado; ao reconectar ele se atualiza. O app continua funcionando sem internet.
- Morador em dois condomínios: um passe por condomínio.
- Troca de aparelho: o passe antigo segue válido até ser removido; "Remover passe" cancela todos.
- Opção desligada pelo síndico: todos os passes do condomínio são negados de imediato na validação e aparecem inválidos na próxima atualização, sem revogar as credenciais; religar a opção os revalida.
- Conta Google ainda sem aprovação de publicação: o botão do Android fica oculto por uma chave de configuração.

## Testes

- Vetores fixos do código `P2`; dia atual e anterior aceitos; dois dias atrás negado.
- Cancelamento nega na leitura seguinte.
- Passe da Apple gerado abre e valida em aparelho real.
- Serviço de atualização: registro, lista de alterados, entrega, remoção, token errado.
- Tarefa diária avisa só os registrados e tolera falha de um aparelho.
- Opção do condomínio desligada.

## Decisões minhas (não vieram do dono do produto)

- Troca diária, com um dia de tolerância.
- Segredo e credencial separados dos do app.
- Sem anti-reuso para o código do passe.
- Só moradores.
- Opção por condomínio desligada por padrão e dependente de "QR no app".
- Passe sem foto e sem CPF.
- Android com `P2`, sem o código rotativo do Google.
- Operador pode cancelar o passe pelo console.
- Uma credencial por carteira; o app não consulta a carteira do aparelho.
- Chaves de assinatura no S3 privado.

## Deixado ao implementador

- Biblioteca para montar e assinar o passe da Apple e cliente da API do Google (são dependências novas; hoje só há `firebase-admin`).
- Pacote do Flutter para apresentar o passe no iPhone.
- Textos do verso do passe.
