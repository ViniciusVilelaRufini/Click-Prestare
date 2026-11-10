# Encomenda com foto e leitura da etiqueta (10/11/2026)

## Por quê
O "Receber nova encomenda" da portaria web não tem mais onde pôr a foto do
volume. O porteiro quer fotografar a encomenda e o sistema já descobrir para
quem é, para cadastrar mais rápido. A foto passa a aparecer no cartão do app e
na lista da web, no mesmo desenho dos eventos (imagem dissolvendo em degradê).

## Decisões do usuário
- Leitura da etiqueta **preenche o formulário e o porteiro confirma** (opção A).
  Nada é cadastrado nem notificado sem o toque em "Receber". Recusada a opção B
  (cadastrar sozinho): um erro de leitura notificaria o morador errado.

## O que já existe (não muda)
- Coluna `Encomendas.foto_volume` (VarChar 500, link). Sem migração de banco.
- `POST` de criação já aceita `foto_volume` como data URL e sobe para o
  storage (`uploadDataUrl(..., 'encomendas')`).
- API de IA com imagem: `IaClient` (produção em Bedrock/Claude; Gemini é
  contingência), já usado pelo app para ler foto de conta.
- App: `EncomendaModel.fotoVolume` já vem da API.

## Mudanças
1. **API — `POST /encomendas/ler-etiqueta`** (autenticado, escopo do
   condomínio do usuário): recebe `{ id_condominio, imagem }` (data URL JPEG/
   PNG/WebP, até 5 MB). Pede à IA um JSON com `nome`, `apto`, `bloco`,
   `transportadora`, `codigo_rastreio`, `descricao` (o que não ler vem null).
   Procura o morador entre os moradores do condomínio: nome sem acento e
   minúsculo, por palavras em comum; apto/bloco lidos desempatam. Devolve
   `{ leitura, destinatario: { apto, bloco, nome } | null }`. Sem IA
   configurada ou erro da IA: responde sem destinatário, o formulário segue
   manual. Nunca grava nada.
2. **Web — gaveta "Receber nova encomenda"**: campo "FOTO DA ENCOMENDA" no
   topo (tirar foto no celular / anexar no computador). Ao escolher: reduz a
   imagem (lado maior 1280px, JPEG 0,8), mostra a prévia e "Lendo etiqueta…",
   chama o endpoint e preenche só os campos ainda vazios; mostra o aviso
   "Preenchido pela etiqueta — confira". O envio leva a foto em `foto_volume`.
3. **Web — lista de encomendas**: célula do volume com a foto à esquerda
   dissolvendo (mesmo `.ps-mor-foto`/degradê só na foto de Visitantes);
   sem foto, como hoje.
4. **App — cartão da encomenda** (`_EncomendaCard`): com foto, ela ocupa a
   esquerda de ponta a ponta e dissolve no cartão (mesmo padrão do
   `CabecalhoPessoa`); sem foto, o ícone atual.

## Abordagens
- Leitura: IA com imagem já existente (escolhida) × OCR + regras (frágil com
  etiquetas variadas) × leitura no navegador (sem acesso aos moradores).
- Automação: A preencher e confirmar (escolhida) × B cadastrar sozinho.

## Fora do escopo
"Avisar encomenda" do morador no app; detalhe da encomenda; lote de etiquetas.

## Restrições
- A foto e a leitura não podem travar o cadastro: qualquer falha volta ao
  formulário manual.
- Não logar a imagem nem o conteúdo lido (dados pessoais).
- Testes: endpoint (casamento de nome, IA fora, tamanho), formulário web
  (preenche só vazios), linha web e cartão do app.
