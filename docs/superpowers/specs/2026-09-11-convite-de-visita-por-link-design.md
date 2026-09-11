# Convite de visita por link — design

O morador gera um link, manda pelo WhatsApp, e o visitante preenche nome, CPF
e foto pelo próprio celular. O morador confirma; o porteiro libera na chegada.

Status: desenho aprovado, não implementado.
Repositório: `c:\Users\vinic\Desktop\Click-with-Prestare`
Workspace Nx: `click-cond-web` · App: `click-cond-app`

---

## 1. Problema

Hoje quem digita os dados do visitante é o morador (app) ou o porteiro
(console). É digitação de dado que o visitante conhece melhor que ninguém, e
acontece no pior momento — ou antes, de memória, ou na portaria com a pessoa
esperando.

A ideia é transferir o preenchimento para quem tem a informação, sem exigir
que o visitante instale nada nem crie conta.

## 2. Decisões tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| O que o link produz | **Rascunho**; o morador confirma | Link encaminhado para a pessoa errada vira um pedido recusável, não um acesso ao prédio |
| Destino da foto | **Só conferência visual** do porteiro | Mantém o dado fora do regime de biometria da LGPD; o facial fica para outra etapa |
| Validade do link | **Uso único**, expira em 24h | Link velho no histórico do WhatsApp não serve para nada |
| Aviso de dados | Aviso **+ aceite obrigatório**, com data registrada | Coleta CPF e foto de quem não é usuário; sem aceite não há prova de consentimento |
| CPF | **Obrigatório** | É a chave de agrupamento por pessoa; sem ele o histórico do visitante fragmenta |
| Quem gera | **Só o morador** | Superfície mínima. Porteiro e síndico seguem no fluxo atual |
| Fotos pedidas | **Só o rosto** | `foto_pessoa` é o que o porteiro usa na chegada. Não guardar imagem de documento de terceiro |

Visitante e prestador usam o mesmo fluxo: `Visitantes.is_prestador` já
distingue os dois na tabela.

## 3. Restrição que molda a solução

`Visitantes` **não representa uma pessoa** — representa uma autorização de
visita (ver a nota `Visitantes - Pessoa vs Visita` no vault). Duas visitas do
mesmo Rodrigo são duas linhas, agrupadas depois por CPF.

O `VisitantesService.create()` tem um comportamento que não pode ser perdido:
ao cadastrar alguém cujo CPF já existe, ele **herda `foto_pessoa`,
`foto_documento` e `face_id`** do registro anterior mais sincronizado. É o que
garante que o terminal facial reconheça um Rodrigo, e não vários rostos
duplicados.

**Consequência para este desenho:** a confirmação do morador tem de passar
pelo `create()` existente. Escrever direto na tabela criaria rosto duplicado
no terminal — um bug que só apareceria no prédio, semanas depois.

## 4. Arquitetura

### 4.1 Geração (app do morador)

`POST /convites`, autenticado. O corpo carrega **apenas o tipo** (visitante ou
prestador). Condomínio e apartamento vêm do token do morador, nunca do corpo —
senão o endpoint aceita convidar para a unidade de outra pessoa.

Resposta: a URL pronta. O app abre o compartilhamento do WhatsApp com uma
mensagem já redigida.

**O banco guarda o hash do token, nunca o token.** Mesma lógica de senha: se o
banco vazar, os links não são utilizáveis.

### 4.2 Página pública `/convite/:token`

Rota sem guard na portaria-web, seguindo `login` e `politica-de-privacidade`,
que já são públicas em `app.routes.ts`. O rewrite do Vercel já manda qualquer
caminho para o `index.html`, então o link profundo funciona sem configuração
nova.

`GET /convites/:token` (público) devolve o mínimo para desenhar a tela: nome
do condomínio, identificação da unidade ("Apartamento 101") e se o convite
vale. **Não devolve o nome do morador.**

Token inválido, expirado e já usado devolvem **resposta idêntica**. Respostas
diferentes transformariam a rota num oráculo que confirma quais tokens
existem.

`POST /convites/:token/responder` (público) grava nome, CPF, foto e a data do
aceite. O token morre nesse instante — uso único.

### 4.3 Confirmação (app do morador)

Push quando alguém preenche. A tela mostra nome, CPF e foto.

- **Confirmar** → backend chama `VisitantesService.create()` com os dados, e a
  visita nasce igual a qualquer outra, com a herança por CPF descrita em §3.
- **Recusar** → status muda e **a foto é apagada do storage na hora**. Dado de
  quem foi recusado não fica guardado.

### 4.4 Retenção

Convite expira em 24 horas. Um job diário apaga a foto e purga os registros
expirados ou recusados.

Sem isso a tabela vira depósito de CPF e foto de gente que nunca entrou no
prédio — o acúmulo que a LGPD cobra, e que o vault já lista como risco em
aberto (`LGPD e Dados Biometricos`).

### 4.5 Segurança

Esta é a **primeira superfície do sistema em que alguém sem conta grava
dado**. As únicas rotas `@Public()` existentes hoje são autenticação e
webhooks de pagamento. O modelo de ameaça muda: link vazado, link reenviado,
robô preenchendo.

- Token de 32 bytes aleatórios (`crypto.randomBytes`), codificado base64url.
- Throttle nas duas rotas públicas.
- Teto de **5 convites ativos** por morador. Gerar o sexto recusa com uma
  mensagem pedindo para aguardar os anteriores expirarem. O número é
  arbitrário e folgado — serve para impedir uso como canal de spam, não para
  limitar o morador de verdade.
- Limite de tamanho na foto (5 MB, o mesmo já usado em `upload-shared-file`) e
  aceitação apenas de imagem. Upload público é vetor de enchimento de storage;
  o uso único do token é a principal contenção.
- A página não expõe morador nem lista de unidades.

## 5. Dados

Tabela nova `Convites_Visita`:

| Campo | Para quê |
|---|---|
| `id` | PK |
| `token_hash` | hash do token; indexado e único |
| `id_condominio`, `id_apartamento` | destino, copiado do token do morador |
| `id_usuario` | quem gerou |
| `is_prestador` | espelha a flag de `Visitantes` |
| `status` | `aguardando` → `preenchido` → `confirmado` / `recusado` / `expirado` |
| `expira_em`, `criado_em` | validade |
| `nome`, `cpf`, `foto_url` | preenchidos pelo visitante |
| | `cpf` gravado **só com dígitos**, com dígito verificador validado no servidor — é a chave de agrupamento por pessoa, e "123.456.789-00" e "12345678900" precisam ser o mesmo Rodrigo |
| `aceite_em` | prova de consentimento |
| `id_visitante` | preenchido na confirmação, liga ao registro criado |

`Visitantes` **só é tocada na confirmação**. A superfície pública nunca
escreve na tabela que o porteiro lê: se alguém esquecer um filtro de status
numa consulta futura, o pior resultado é não aparecer nada — e não um estranho
não confirmado listado como visitante autorizado. O repositório já tem cicatriz
dessa classe de erro (`Padrao de Bug - Autorizacao na Tela nao no Servidor`).

**Migração:** o Railway não roda migração automática. O SQL do `CREATE TABLE` é
escrito para aplicação manual e verificada **antes** do deploy da API, como nas
rodadas anteriores.

## 6. Testes

Todos com HTTP e storage mockados.

- Token inexistente, expirado e já usado produzem resposta idêntica.
- `POST /convites` recusa quem não é morador, e ignora condomínio/apartamento
  enviados no corpo.
- Preencher duas vezes o mesmo token falha na segunda.
- Confirmação passa pelo `create()` e herda foto/`face_id` quando o CPF já
  existe no condomínio.
- Recusa apaga a foto do storage.
- Convite de um condomínio não pode ser confirmado por morador de outro.
- Aceite ausente recusa o envio.

## 7. Fora desta entrega

- **Enrolamento facial.** A foto é conferência visual do porteiro. Ligar o
  facial exige consentimento específico de dado sensível, base legal declarada
  e política de retenção — e as pendências que o vault já lista (política de
  privacidade citando reconhecimento facial, Data Safety da Play Store)
  precisam estar fechadas antes.
- **Porteiro e síndico gerando link.** Só o morador, por ora.
- **Foto de documento.** Só o rosto.

## 8. Riscos conhecidos

- **Expira em 24h** pode ser curto para convite de festa marcada para a semana
  seguinte. Se aparecer atrito real, o prazo vira configuração — não vale
  antecipar agora.
- **Visitante sem câmera ou sem jeito com o celular** trava no meio. O fluxo
  antigo continua existindo como saída: o morador cadastra manualmente.
- **O link revela a unidade de destino** a quem o tiver. É aceitável — foi o
  morador que enviou —, mas é bom saber que a informação está ali.

## Ver também

- Nota do vault: `Visitantes - Pessoa vs Visita`
- Nota do vault: `LGPD e Dados Biometricos`
- Nota do vault: `Padrao de Bug - Autorizacao na Tela nao no Servidor`
