# Integração Superlógica — Taxa Condominial no Clique

Espelha as cobranças do ERP Superlógica Condomínios dentro do app Clique, para que o
morador veja a taxa condominial e pague por Pix copia-e-cola sem sair do aplicativo.

**Status:** base implementada. Nenhum condomínio ativo. Nenhuma sincronização rodando.

---

## 1. Contexto de negócio

A Prestare administra 17 condomínios no ERP Superlógica. Esses são clientes da
**administradora**, não do **app**. Nenhum deles usa o Clique hoje.

O Clique é vendido condomínio a condomínio. A integração acompanha essa venda:

> "O condomínio tal aprovou. Aí sim vamos iniciar."

Ativar um condomínio é, portanto, um **evento comercial**, não um passo de infra. Ele
acontece pelo painel do CRM, com um clique, no dia em que o contrato fecha.

### Divisão com o financeiro existente

| Origem | Responsável | Situação |
|---|---|---|
| Taxa condominial | **Superlógica** (fonte da verdade) | esta integração |
| Contas pessoais do morador, lançamentos avulsos | Financeiro próprio do Clique | inalterado |
| OpenPix | — | não operacional; fora do escopo |

A Superlógica **não substitui** o módulo financeiro do Clique. Ela passa a ser dona de um
tipo de lançamento: a taxa condominial dos condomínios ativados.

---

## 2. Regra de segurança: leitura, com uma exceção declarada

O ERP é a operação financeira real da Prestare, com boletos de clientes reais. Um POST
equivocado altera cobrança de verdade, de gente de verdade.

O ERP é a operação financeira real da Prestare. **Cobrança, unidade e condomínio são
somente leitura — sempre.** A única escrita permitida é cadastrar condômino numa unidade
(§7), e ela é opcional por condomínio.

Imposto em camadas, em `superlogica.client.ts`:

1. **Duas allowlists separadas.** `get()` só aceita as três rotas de leitura;
   `putEscritaRestrita()` só aceita `unidades/post`. Estar liberada para escrita não
   libera a rota para leitura, nem o contrário. Allowlist e não blocklist: esquecer de
   proibir algo novo não abre brecha, porque o padrão é negar.
2. **Um único método de escrita, de nome longo.** Quem escrever `client.put(...)` sem
   querer não encontra o método.
3. **Blocklist por cima das duas** — termos proibidos são recusados mesmo que alguém
   amplie uma allowlist sem pensar. Nada de `liquidar`, `estornar`, `excluir`.
4. **Interruptor por condomínio.** `Condominios.superlogica_escrita`, default 0.

### Rotas proibidas

A blocklist parece redundante diante da allowlist, mas cobre um caso específico. Este
endpoint é um `GET` de leitura aparente que **dispara e-mail real para o morador**:

```
condor/atual/publico/emailcobrancasemaberto?cpf=...
```

Chamá-lo em desenvolvimento manda e-mail de cobrança para uma pessoa real. A blocklist real
(`ROTAS_PROIBIDAS` em `superlogica.client.ts`) tem oito termos:
`emailcobrancasemaberto`, `notificarcomunicado`, `liquidar`, `estornar`, `excluir`,
`desinvalidar`, `desfazer`, `imprimircarta`. `update`, `put`, `post` e `delete` **não**
estão nela — e `post` não pode estar: bloquear a palavra bloquearia a própria
`unidades/post`, a única rota de escrita permitida. Quem barra escrita indevida ali não é
a blocklist, é a allowlist separada de `putEscritaRestrita()` (item 1 acima).

### Testes

Testes automatizados usam HTTP mockado — nunca a rede. Não se valida integração
disparando chamada contra condomínio de cliente real.

---

## 3. Credenciais

Geradas no ERP em *Todos os usuários → API (Integração com outros sistemas) →
Aplicativos (e-mail) → Novo App Token*.

```
SUPERLOGICA_APP_TOKEN=<36 chars>
SUPERLOGICA_ACCESS_TOKEN=<36 chars>
SUPERLOGICA_LICENCA=prestare
```

Configuradas no `.env` local e nas Variables do serviço no Railway.

> **O token herda as permissões do usuário que o criou.** O atual foi gerado pela conta
> `erika@prestaregestao.com.br` e enxerga a carteira inteira (17 condomínios).

> **⚠️ Validade de 1 ano — expira em 26/08/2027.** Quando vencer, a sincronização para de
> funcionar. Renovar gerando um novo app no ERP e trocando as duas variáveis.

`SUPERLOGICA_LICENCA` **não é lida por nenhum código hoje** — `grep` no projeto inteiro
não acha um leitor, e o `baseUrl` do cliente é fixo em
`https://api.superlogica.net/v2/condor` (`superlogica.client.ts`). A variável fica
reservada: nem tudo no ERP mora em `api.superlogica.net`, alguns recursos ficam em
`<licenca>.superlogica.net`, mas nenhum dos usados hoje (§4) é um deles. Deixá-la vazia
não quebra a integração atual; ela só passa a importar no dia em que algum endpoint novo
exigir o domínio com licença.

---

## 4. A API

**Base:** `https://api.superlogica.net/v2/condor/{CONTROLLER}/{ACTION}`
**Docs:** <https://apicondominios.superlogica.com/> (collection Postman)

Autenticação por headers, sem OAuth:

```http
app_token: ...
access_token: ...
Content-Type: application/json
```

### Endpoints usados

| Uso | Endpoint |
|---|---|
| Listar condomínios (tela de ativação) | `GET /condominios/get?somenteCondominiosAtivos=1` |
| Importar unidades e moradores | `GET /unidades/index?idCondominio=&exibirDadosDosContatos=1` |
| Sincronizar cobranças | `GET /cobranca/index?idCondominio=&status=validos&dtInicio=&dtFim=` |

### Particularidades verificadas em produção

Comportamentos confirmados por chamada real, não documentados (ou documentados de forma
incompleta) pela Superlógica:

- **Datas em `MM/DD/AAAA`.** Formato americano. Mandar `01/02/2026` querendo 1º de
  fevereiro retorna janeiro. Sempre usar o helper `formatarDataSuperlogica()`.
- **`itensPorPagina` tem teto de 50.** Acima disso a API responde
  `400 {"msg":"Itens por página não pode ser superior a 50."}`. Toda listagem pagina.
- **`fl_status_recb`**: `0` = pendente, `3` = pago (confirmado: todos os `3` têm
  `dt_liquidacao_recb` e `dt_recebimento_recb` preenchidos; nenhum `0` tem).
- **Pix e boleto vêm prontos na listagem.** Os exemplos da documentação oficial são
  reduzidos e não mostram esses campos, mas a resposta real traz `st_pixqrcode_recb`
  (payload EMV completo) e `link_segundavia` — ambos preenchidos em 100% da amostra.
  Não é preciso chamar `gerarlinksegundavia` separadamente.
- **Não existe webhook.** Nenhum callback é oferecido. A sincronização é por *polling*.

---

## 5. Fluxo completo

### 5.1 Venda e ativação

```
Condomínio aprova a proposta
        ↓
CRM → "Ativar condomínio"
        ↓
Lista os 17 condomínios da Superlógica  (GET /condominios/get)
        ↓
Operador escolhe e confirma
        ↓
Condominios.id_superlogica_cond ← id_condominio_cond
        ↓
Importa unidades          (GET /unidades/index)
   → cria Apartamentos com id_superlogica_uni já preenchido
        ↓
Condomínio ativo. Cron passa a sincronizar.
```

O vínculo **é** o interruptor: sem `id_superlogica_cond` preenchido, o condomínio é
ignorado por toda a integração.

A tela fica em **CRM → Superlógica** (`/painel/superlogica`), sob `CrmAdminGuard`: ativar
é ato comercial da operadora, não do síndico. Ela lista os condomínios do Clique lado a
lado com os do ERP, marca quais já estão em uso, e mostra ao fim os condomínios da
carteira que ainda não compraram o app.

### Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/crm/superlogica/status` | credenciais presentes no servidor? |
| GET | `/crm/superlogica/condominios` | condomínios do ERP, marcando os já vinculados |
| GET | `/crm/superlogica/clientes` | condomínios do Clique e o estado do vínculo |
| GET | `/crm/superlogica/clientes/:id/preview-unidades` | prévia das unidades — **não importa nada** |
| POST | `/crm/superlogica/clientes/:id/vincular` | ativa |
| DELETE | `/crm/superlogica/clientes/:id/vincular` | desativa |
| POST | `/crm/superlogica/clientes/:id/importar-unidades` | cria/vincula os apartamentos |
| POST | `/crm/superlogica/clientes/:id/sincronizar` | roda o sync agora |

### Travas da ativação

- **Um condomínio do ERP só alimenta um do Clique.** Vincular o mesmo id em dois prédios
  faria as duas sincronizações puxarem as mesmas cobranças, e um veria os boletos do
  outro. A aplicação recusa com 409; o índice `un_cond_superlogica` fecha a janela de
  corrida entre a consulta e a gravação.
- **O id da Superlógica é conferido contra a lista real do ERP** antes de gravar. Aceitar
  um número qualquer criaria um vínculo que só falharia na primeira sincronização.
- **Desativar não apaga o que já foi sincronizado** — só interrompe a atualização. Apagar
  histórico financeiro do morador por um clique no CRM seria destrutivo demais.
- **Toda ativação e desativação vai para a auditoria**, com o operador e o vínculo
  anterior. É evento de dinheiro.

### 5.2 Por que não existe problema de "de-para"

A Superlógica identifica unidade como `bloco="01"` + `unidade="000101"`, com zeros à
esquerda. O Clique grava `bloco` e `apto` em texto livre. Casar isso por comparação de
string é frágil — e errar significa **mostrar o boleto de um morador para outro**.

A importação elimina o risco: os apartamentos são *criados a partir* da Superlógica, com
`id_superlogica_uni` gravado no ato. O vínculo é por ID, nunca por texto.

Condomínio já cadastrado manualmente no Clique é a única exceção, e precisa de
conferência antes de ativar.

### 5.3 Sincronização

Cron de hora em hora, varrendo mês corrente e anterior, apenas dos condomínios
vinculados. Boleto muda devagar; essa frequência mantém o volume de chamadas baixo.

```
Para cada condomínio com id_superlogica_cond:
    GET /cobranca/index (paginado de 50 em 50)
        ↓
    Casa id_unidade_uni → Apartamentos.id_superlogica_uni
        ↓
    UPSERT em Financeiro por (origem, id_externo)
```

O índice único `(origem, id_condominio, id_externo)` garante que rodar o cron duas vezes
não duplique lançamento.

Implementado em `superlogica-sync.service.ts`, no padrão de tarefa periódica do projeto
(`OnModuleInit` + `setInterval`, com flag anti-reentrância). Detalhes que importam:

- **Janela**: do início do mês anterior ao fim do mês seguinte. Pega boleto já emitido
  para o mês que vem e mudança de status em cobrança antiga.
- **Sem condomínio vinculado, o tick nem fala com o ERP** — conta antes de sair.
- **Falha em um condomínio não interrompe os outros.**
- **O upsert só atualiza o que a Superlógica conhece** (valor, vencimento, pago, Pix,
  boleto). `url_comprovante` e `photo`, que o operador pode ter anexado no Clique, não
  são tocados.
- **Cobrança de unidade não importada não é gravada.** Sem apartamento não há a quem
  mostrar, e adivinhar o vínculo é como cobrança aparece para o morador errado.

### 5.3.1 Normalização na importação

O ERP identifica unidade com zeros à esquerda (`"000408"`, bloco `"01"`). A importação
normaliza para `408` / `4`, porque é assim que o casamento por texto do Financeiro
espera — e porque "Apto 000408" na tela do morador seria errado. Identificação não
numérica (`"0A1"`, `"Casa 3"`) é preservada como está.

Duas unidades do ERP que normalizam para a mesma identificação **não são importadas** e
saem em `duplicadasIgnoradas`: importar as duas faria uma sobrescrever o vínculo da
outra, e as cobranças de uma cairiam na outra.

### 5.3.2 Somente leitura no Clique

Lançamento com `origem='superlogica'` não pode ser editado, removido, baixado nem
conciliado pelo Clique (`assertLancamentoEditavel` em `financeiro.service.ts`). A fonte
da verdade é o ERP: marcar pago aqui duraria até o próximo sync e sumiria sozinho, o que
é pior que recusar. Anexar comprovante continua permitido — o sync não toca nesse campo.

### 5.4 O morador

Vê a taxa condominial na tela financeira, copia o Pix, paga. O status volta como pago na
sincronização seguinte.

**O morador não marca nada como pago.** O status vem exclusivamente da Superlógica. Pelo
mesmo motivo, lançamentos com `origem='superlogica'` são somente leitura também para o
síndico — editar no Clique faria o app divergir do ERP sem que ninguém percebesse.

---

## 6. Modelo de dados

```sql
ALTER TABLE Condominios  ADD COLUMN id_superlogica_cond INT NULL;
CREATE UNIQUE INDEX un_cond_superlogica ON Condominios (id_superlogica_cond);
ALTER TABLE Apartamentos ADD COLUMN id_superlogica_uni  INT NULL;
ALTER TABLE Financeiro   ADD COLUMN id_externo VARCHAR(50) NULL,
                         ADD COLUMN origem     VARCHAR(20) NULL;
CREATE UNIQUE INDEX un_fin_origem_externo
  ON Financeiro (origem, id_condominio, id_externo);
```

`id_condominio` entra na chave única **de propósito**. A Superlógica não documenta se
`id_recebimento_recb` é único entre condomínios da mesma licença. Se não for, duas
cobranças de prédios diferentes colidiriam no upsert e uma sobrescreveria a outra — o
morador veria o boleto e o Pix de um condomínio alheio. Com o condomínio na chave, a
colisão é impossível, sem depender de suposição não verificada.

Todas as colunas são anuláveis: nada muda para quem já usa o sistema.

> **Aplicado na produção em 26/08/2026** via
> `prisma/manual_2026-08_superlogica.sql`, e verificado por `SELECT` em cada
> coluna e no índice. O script é idempotente — reexecutar é no-op.

```sql
CREATE UNIQUE INDEX un_apto_superlogica ON Apartamentos (id_condominio, id_superlogica_uni);
```

`(id_condominio, id_superlogica_uni)`: impede dois apartamentos do mesmo condomínio
carregarem o mesmo `id_unidade_uni` do ERP. Sem esse índice, o `Map` de
`superlogica-sync.service.ts` guarda só o último apartamento com aquele id, e as
cobranças da unidade caem no apartamento errado — em silêncio, dinheiro de morador
aparecendo na tela de outro.

> **⚠️ PENDENTE DE APLICAÇÃO.** Definido no `schema.prisma` e no script manual
> `prisma/manual_2026-08_superlogica_unidade_unica.sql`, mas **não foi rodado em
> produção** — ao contrário do índice acima, este ainda não existe no banco. Enquanto
> não for aplicado, a proteção que ele dá não existe de fato: dois apartamentos do
> mesmo condomínio podem carregar o mesmo `id_superlogica_uni` sem que nada acuse. O
> script inclui uma consulta de diagnóstico de duplicatas para rodar antes.

### De-para dos campos

| `Financeiro` (Clique) | Superlógica | Observação |
|---|---|---|
| `id_externo` | `id_recebimento_recb` | chave da deduplicação |
| `origem` | `'superlogica'` | fixo |
| `valor` | `vl_total_recb` | |
| `data_vencimento` | `dt_vencimento_recb` | chega como `MM/DD/AAAA HH:mm:ss` |
| `pago` | `fl_status_recb === '3'` | |
| `data` | `dt_liquidacao_recb` | vazio enquanto pendente |
| `url_boleto` | `link_segundavia` | |
| `pix_copia_cola` | `st_pixqrcode_recb` | payload EMV |
| `descricao` | `st_documento_recb` | |
| `categoria` | `'Taxa Condominial'` | fixo |
| `nome` | — | **gerado**, ver abaixo |

### ⚠️ O campo `nome` não é cosmético

O Financeiro do Clique descobre de qual morador é uma cobrança **parseando o texto** de
`nome`, no formato `"Apto X Bloco Y - Ref. MM/AAAA"` (`nomeFaturaDeApto` em
`financeiro.service.ts`). O comentário acima da regex, naquele método, registra um
vazamento de dados entre apartamentos causado por casamento por substring — detalhado
logo abaixo.

Consequências para o mapper:

- O nome é montado a partir do `apto`/`bloco` do **Apartamentos do Clique**, nunca dos
  campos do ERP — `st_unidade_uni` vem `"000408"`, e `\bApto 408\b` não casaria com isso.
- Fugir do formato faz a cobrança não aparecer para ninguém, ou aparecer para o morador
  errado.

**A fronteira do regex é explícita, não `\b`.** `\bApto\s+10\b` barra dígito colado
("101" não casa com apto "10"), mas `\b` sozinho não barra pontuação colada — e
`normalizarUnidade` preserva identificação não numérica no apto, então formatos assim
existem em produção:

| Nome gerado | Apto do perfil | `\b` (antes) | `(?=\s\|$)` (agora) |
|---|---|---|---|
| `"Apto 10.1 Bloco A - Ref. 08/2026"` | `10` | casava (vazava) | não casa |
| `"Apto 10-A Bloco A - Ref. 08/2026"` | `10` | casava (vazava) | não casa |
| `"Apto 10/2 Bloco A - Ref. 08/2026"` | `10` | casava (vazava) | não casa |
| `"Apto 101 Bloco A - Ref. 08/2026"` | `10` | não casava | não casa |
| `"Apto 10 Bloco A - Ref. 08/2026"` | `10` | casava | casa |

`nomeFaturaDeApto` (`financeiro.service.ts`) trocou a fronteira final por lookahead
`(?=\s|$)`, que exige espaço ou fim de string depois do token — o único formato que todo
produtor de nome deste documento gera. Fail-closed de propósito: lançamento legado com
pontuação colada no apto deixa de casar em vez de continuar vazando; melhor sumir da tela
do morador certo do que aparecer na do errado.

Isso estreita a fronteira, não elimina o casamento por texto. Isso é uma fragilidade
herdada, não uma escolha desta integração. Como agora existe
`Apartamentos.id_superlogica_uni`, o caminho certo a médio prazo continua sendo dar a
`Financeiro` uma FK `id_apartamento` e aposentar o casamento por texto de vez — essa
dívida segue aberta.

O mapper descarta a cobrança (em vez de gravar algo ambíguo) quando:

- não há vencimento válido — data inválida quebraria a tela do morador;
- a unidade é vazia ou só de zeros (`"0000"`, a unidade fantasma que o ERP usa para
  lançamento do próprio condomínio) — geraria `"Apto  - Ref..."`, texto que o regex do
  Financeiro pode encaixar em mais de um morador;
- o valor não é numérico.

## 6.1 Regra para quem for escrever a sincronização

`idCondominio` enviado à Superlógica **nunca** pode vir de entrada do usuário. Sempre lê
de `Condominios.id_superlogica_cond` do condomínio já validado pelo tenant guard. Aceitar
esse id do cliente permitiria a um síndico pedir as cobranças de outro condomínio.

---

## 7. Estado atual e próximos passos

**Implementado**

- [x] Colunas de vínculo no schema
- [x] Cliente HTTP com guard de método e blocklist
- [x] Service de leitura (condomínios, unidades, cobranças) com paginação
- [x] Mapper Superlógica → `Financeiro`
- [x] Testes unitários com HTTP mockado
- [x] Tela de ativação no CRM (`/painel/superlogica`) com vincular/desvincular,
      prévia de unidades e auditoria

- [x] Importação de unidades gravando `Apartamentos` com `id_superlogica_uni`
- [x] Sincronização de cobranças com upsert (tick horário + disparo manual)
- [x] Bloqueio de edição para `origem='superlogica'`
- [x] Envio de morador ao ERP (§7.1), com apartamento resolvido por vínculo ID
      (`Apartamentos_Users`), envio serializado por unidade e recusa (em vez de
      chute) quando o vínculo é ambíguo ou inexistente

**Pendente**

- [ ] Botões de importar/sincronizar na tela do CRM (as rotas já existem)
- [ ] Ajuste da tela do morador no app Flutter (hoje ele já lista `Financeiro`;
      falta conferir a apresentação de Pix e boleto vindos do ERP)
- [ ] Aplicar em produção o índice `un_apto_superlogica` (§6) — definido no
      schema e no script manual, ainda não rodado no banco

---

## 7.1 Mão dupla: envio de morador ao ERP

Único caminho de escrita. Quando um proprietário ou morador é cadastrado no Clique, ele
é criado como **contato da unidade** correspondente na Superlógica.

**Rota:** `PUT /v2/condor/unidades/post` (form-urlencoded), com `ID_CONDOMINIO_COND`,
`ID_UNIDADE_UNI` e `contatos[n][...]`.

### Decisões que valem mais que o código

**O apartamento é resolvido pelo vínculo por ID (`Apartamentos_Users`), não por texto.**
O casamento por bloco/apto em texto continua existindo no código como via secundária,
mas o vínculo por ID vem primeiro porque bloco/apto `NULL` casava com qualquer linha nula
do condomínio — morador podia ir parar na unidade errada do ERP real. Vínculo ambíguo
(mais de um apartamento possível) também vira **recusa com motivo**, nunca chute: errar
de unidade aqui é escrita real no ERP, e desfazer não é automático.

**O envio é serializado por unidade.** Uma fila em memória (`filasPorUnidade`) garante
que dois envios para a mesma unidade nunca leiam a lista de contatos ao mesmo tempo — sem
isso, dois PUTs simultâneos partiam da mesma lista antiga e o segundo apagava o contato
que o primeiro acabara de criar. A leitura dos contatos acontece **dentro** da seção
crítica, não antes dela. Premissa que a proteção carrega: **o Railway roda uma única
réplica.** Com múltiplas réplicas, o mutex em memória de cada processo não veria as
outras, e a corrida volta a existir — vira lock no banco nesse cenário, não está feito.

**`reenviarPendentes` não varre mais o condomínio inteiro por morador.** O lote lê a
entrada uma vez, e o resultado de cada envio (inclusive a unidade relida) atualiza a
lista em memória para o próximo morador da mesma unidade — evita reintroduzir a corrida
dentro do próprio laço. No lote, **morador sem CPF nem e-mail é recusado antes de
escrever**: a confirmação de sucesso depende de reconhecer o contato novo por um dos
dois, e sem nenhum, cada passada do lote criaria mais um contato órfão na unidade real do
ERP, sem teto. O envio avulso, que lê dentro do lock, continua dando conta desse morador
por diff de ids.

**O contato entra sem receber cobrança** (`ID_TIPORESP_TRES = 4`). Cadastrar alguém no
app não pode mudar para quem o boleto é emitido — isso é decisão financeira da
administradora, tomada no ERP. O Clique cria cadastro, não sacado.

**A lista de contatos existente é reenviada por `ID_CONTATO_CON`.** O endpoint se chama
"Editar unidade" e a documentação não diz se a lista de contatos é substituída ou
acrescida. Mandando todos os contatos atuais mais o novo, o resultado é o mesmo nas duas
hipóteses — e ninguém perde morador. Essa é a proteção central deste caminho.

**Nada é enviado sem `superlogica_escrita = 1`** naquele condomínio, ligado à mão no CRM
com uma confirmação explícita.

**Idempotência por `Moradores.id_superlogica_con`.** Morador já enviado não é reenviado.
Antes de escrever, procura-se o contato na unidade por CPF (só dígitos) ou e-mail: se já
existe, os dois lados são amarrados sem escrever nada. Casamento por nome não é usado —
seria pedir para vincular a pessoa errada.

**Best-effort.** O ERP fora do ar não pode impedir um cadastro no Clique: a falha vai
para o log, não para a tela do usuário.

**Sem eco na importação.** Morador criado pela importação (que veio do ERP) leva
`skipSuperlogica`, senão voltaria para lá como contato duplicado.

### A Superlógica recusa com HTTP 200

Aprendido no primeiro envio real. Um morador com CPF de números aleatórios não
subia, e nada indicava por quê: **o ERP responde `HTTP 200` mesmo quando recusa a
operação** — o veredito fica em `status`/`msg` dentro do corpo.

Duas consequências no código:

- O corpo é sempre inspecionado; `status` diferente de `200` é falha, e a `msg`
  do ERP volta para a tela.
- O sucesso é **confirmado**, não presumido: os ids dos contatos da unidade são
  guardados antes da escrita, e um id novo precisa aparecer depois. Vale também
  para morador sem CPF nem e-mail, que o casamento por dados não reconheceria.
- CPF é validado por módulo 11 **antes** de enviar, virando a mensagem "CPF
  inválido — corrija no cadastro do morador" em vez de uma recusa silenciosa.

O caso real: o CRM chegou a exibir "1 de 1 enviado" para um morador que não
existia no ERP. Sucesso falso é pior que falha — esconde o problema e tira o
morador da fila de pendentes, então nada tenta de novo.

### O que continua fora

Criar unidade, alterar cobrança, dar baixa, excluir contato. Se um apartamento do Clique
não tem unidade correspondente no ERP, o envio é recusado com motivo — criar a unidade lá
seria escrita muito além do combinado.

## 8. Decisões em aberto

**Importar os contatos dos moradores junto com as unidades?** O endpoint devolve nome,
e-mail e telefone por unidade. Importar deixa o onboarding instantâneo; deixar o morador
se cadastrar sozinho pelo app é mais conservador quanto a dado pessoal. As unidades são
importadas de qualquer forma — a dúvida é só sobre os contatos.

**Existe condomínio já cadastrado manualmente no Clique?** Se houver algum além dos de
teste, ele não tem `id_superlogica_uni` nos apartamentos e precisa de conferência manual
antes da ativação.
