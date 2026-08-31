# Plano — Correção dos vazamentos e falhas da integração Superlógica

Origem: auditoria de segurança da integração Superlógica (leitura estática, sem
nenhuma chamada ao ERP). Corrige um vazamento de dados financeiros entre
apartamentos, uma corrida que pode apagar contato real no ERP, e três lacunas
entre o que `INTEGRACAO_SUPERLOGICA.md` promete e o que o código faz.

Repositório: `c:\Users\vinic\Desktop\Click-with-Prestare`
Workspace Nx: `click-cond-web` (Nx + Jest, gerenciador `npm`)
Branch: `fix/superlogica-vazamentos` (a partir de `master` @ 848e154)

---

## Global Constraints

Estas valem para TODAS as tasks. Violá-las é defeito, mesmo que o texto da
task não repita.

1. **NUNCA chamar a API da Superlógica.** Nenhuma requisição de rede a
   `*.superlogica.net`, em nenhuma circunstância — nem contra o condomínio de
   teste PRESTARE. Todo teste usa HTTP mockado (`global.fetch = jest.fn()`),
   que é o padrão já estabelecido em `superlogica.client.spec.ts:20-21`.
2. **NUNCA aplicar SQL em banco.** O `DATABASE_URL` do `.env` aponta para o
   banco de PRODUÇÃO. Nenhuma task roda `prisma migrate`, `prisma db push`,
   nem executa `.sql`. Task 3 apenas *escreve* o arquivo SQL; quem aplica é o
   humano.
3. **Não inventar parâmetros de query da API Superlógica.** Só existem os
   parâmetros já usados hoje em `superlogica.service.ts`. Nada pode ser
   verificado contra a API real (ver constraint 1), então nenhum parâmetro
   novo entra.
4. **Rodar os testes e colar a saída no relatório.** Comando a partir de
   `click-cond-web`: `npx jest --config apps/api/jest.config.cts <caminho>`.
   Se um teste falhar, conserte — não relate DONE com teste vermelho.
5. **Comentários em português**, no mesmo tom denso do código existente
   (explicam POR QUE, não O QUE). Não reescreva comentários já existentes que
   continuam corretos.
6. **Nada de refactor oportunista.** Só o que a task pede. Este código mexe
   com dinheiro de gente real; diff pequeno é revisável.
7. **Não relaxar as travas de segurança existentes**: as allowlists e a
   blocklist de `superlogica.client.ts` não mudam em nenhuma task.

---

## Task 1 — Fechar o vazamento de boleto entre apartamentos

**Arquivo:** `click-cond-web/apps/api/src/app/financeiro/financeiro.service.ts`

### O defeito

`nomeFaturaDeApto` (linha ~170) usa `\b` como fronteira final do número do
apartamento. `\b` resolve o caso dígito ("Apto 10" não casa "Apto 101"), mas
NÃO resolve o caso pontuação. Comprovado rodando o regex atual:

```
apto "10" vs "Apto 10.1 - Ref. 08/2026"  => true   ← VAZAMENTO
apto "10" vs "Apto 10-A - Ref. 08/2026"  => true   ← VAZAMENTO
apto "10" vs "Apto 10/2 - Ref. 08/2026"  => true   ← VAZAMENTO
apto "10" vs "Apto 101 - Ref. 08/2026"   => false  (esse o `\b` já pegava)
```

Isso ficou alcançável por causa da integração: `normalizarUnidade` em
`superlogica-sync.service.ts:64-72` preserva de propósito identificação não
numérica, então `"10-A"` e `"10.1"` entram em `Apartamentos.apto` exatamente
assim, e o sync gera lançamentos com esses nomes em massa.

Consequência: o morador do apto 10 vê o lançamento do apto 10-A **com o
`pix_copia_cola` e o `url_boleto`** — ele vê o valor da taxa do vizinho e
consegue pagar a conta dele.

### O que fazer

Trocar a fronteira final `\b` por uma asserção explícita de fim de token,
tanto para o apto quanto para o bloco.

Todos os produtores desses nomes separam os campos por espaço:
- `montarNomeLancamento` (`superlogica.service.ts:121-129`) → `"Apto X Bloco Y - Ref. MM/AAAA"` / `"Apto X - Ref. MM/AAAA"`
- os formatos legados citados no comentário → `"- Rateio: ..."`, `"- Acordo Parc."`

Logo, o token do apto (e o do bloco) é sempre seguido de espaço ou de fim de
string. A asserção correta é `(?=\s|$)`.

O `escape()` existente continua necessário e não muda.

### Ruling do controller (já decidido, não reabrir)

Este fix é **fail-closed de propósito**. Se existir no banco algum lançamento
legado com pontuação colada no número (`"Apto 10. - Ref..."`), ele deixa de
casar e some da tela daquele morador, em vez de continuar casando frouxo.
Não mostrar uma cobrança é recuperável; mostrar o Pix do vizinho não é.
Escreva um teste que **documente** esse comportamento explicitamente, para
que a escolha fique registrada em vez de virar surpresa.

### Testes obrigatórios

Crie `financeiro.nome-fatura.spec.ts` ao lado do service. `nomeFaturaDeApto`
é `private` — teste-o via `(service as any).nomeFaturaDeApto(...)` ou
extraia-o para uma função estática exportada, o que preferir; se extrair,
mantenha o método de instância delegando, para não mexer nos ~14 call sites.

Casos que o teste PRECISA cobrir:
- os quatro casos da tabela do defeito acima, agora com `10.1`, `10-A`,
  `10/2` retornando `false` e `101` continuando `false`
- casamento correto que deve continuar funcionando: apto `10` vs
  `"Apto 10 - Ref. 08/2026"` → true; apto `10` vs `"Apto 10 Bloco A - Ref. 08/2026"` com bloco `A` → true
- bloco: apto `10` bloco `A` vs `"Apto 10 Bloco AB - Ref..."` → false
- morador sem bloco vs nome com bloco → false (regra da linha ~190-192, não pode regredir)
- apto com caractere regex-especial (`"1+2"`) não quebra o regex
- o caso fail-closed do ruling, com comentário no teste dizendo que é escolha deliberada

### Feito quando

Testes novos passam, e `npx jest --config apps/api/jest.config.cts apps/api/src/app/financeiro` continua verde.

---

## Task 2 — Endurecer o envio de morador ao ERP

**Arquivo:** `click-cond-web/apps/api/src/app/superlogica/superlogica-write.service.ts`
**Spec de referência:** `INTEGRACAO_SUPERLOGICA.md` §7.1

Três defeitos no mesmo arquivo, resolvidos numa task só porque se sobrepõem.

### 2a. Resolução de apartamento por texto (volta a fragilidade que §5.2 diz ter eliminado)

`carregarContexto` (linhas ~208-215) resolve o apartamento com
`findFirst({ id_condominio, bloco: morador.bloco || null, apto: morador.apartamento || null })`
— casamento por TEXTO, apesar de o vínculo por ID já existir em
`Apartamentos_Users`.

Falha concreta: morador com `apartamento` nulo/vazio vira
`findFirst({ bloco: null, apto: null })`, que casa com **qualquer** linha de
`Apartamentos` de bloco/apto NULL daquele condomínio (o unique
`un_apto_cond` não impede múltiplas, porque MySQL trata NULL como distinto).
Se essa linha tiver `id_superlogica_uni`, o morador é gravado numa **unidade
errada do ERP real**. Renomear um apartamento também quebra a resolução, em
silêncio.

**Fazer:**
1. Preferir o vínculo por ID: buscar `Apartamentos_Users` por
   `morador.id_user`, com o apartamento restrito a
   `apartamento.id_condominio === morador.id_condominio`, e usar o
   apartamento de lá. Se houver mais de um vínculo no condomínio, prefira o
   que tem `id_superlogica_uni` não nulo; havendo ainda empate, **recuse** o
   envio com motivo `'morador vinculado a mais de um apartamento — envie pelo painel'`
   (adivinhar é como o morador entra na unidade errada).
2. Só cair no casamento por texto se não houver vínculo por ID.
3. **Nunca** casar com apto vazio: se `morador.apartamento` for nulo/vazio
   e não houver vínculo por ID, recuse com motivo
   `'morador sem apartamento identificado'`. Hoje esse caso casa NULL/NULL e escreve no ERP.

### 2b. Corrida que pode APAGAR contato real no ERP

`enviarMorador` (linhas ~256-302) lê a lista de contatos da unidade, monta o
payload com ela, e só depois faz o PUT. Os dois gatilhos de envio automático
são fire-and-forget, sem lock nem fila:
- `moradores.service.ts:855` (painel web)
- `mobile-auth.service.ts:2783` (app — inclusive `insertFamiliar`, que um
  morador comum alcança com `permitirSemStaff`)

Dois envios simultâneos para a MESMA unidade:
1. A e B leem `contatos = [1,2]`; ambos guardam `idsAntes = {1,2}`.
2. A faz PUT com `[1,2,novoA]`. B faz PUT com `[1,2,novoB]` — **sem o contato de A**.
3. Se o endpoint substitui a lista (a hipótese que §7.1 declara não resolvida,
   e contra a qual o reenvio-de-todos-os-contatos é justamente a proteção), o
   PUT de B **apaga o contato de A do ERP real**.
4. Na confirmação, A relê e acha "um id que não estava em `idsAntes`" — que
   pode ser o de B. `id_superlogica_con` fica cruzado; e como esse campo é a
   trava de idempotência, ninguém tenta de novo.

A proteção central do design pressupõe uma serialização que o código não tem.

**Fazer:**
1. Mutex em memória por unidade, chave `${idCondominioSuperlogica}:${idUnidadeSuperlogica}`.
   Implementação simples: `Map<string, Promise<unknown>>` encadeando as
   promessas; libere a chave do Map ao terminar, senão o Map cresce sem fim.
2. **Dentro** da seção crítica, reler os contatos da unidade imediatamente
   antes de montar o payload e antes de calcular `idsAntes`. A leitura que
   hoje acontece antes de todas as validações fica obsoleta durante a janela.
3. A checagem "contato já existe" (`acharContato`) deve usar a leitura
   FRESCA de dentro do lock, não a antiga.

**Ruling do controller (já decidido, não reabrir):** mutex em processo é
suficiente por ora — o Railway roda uma réplica. Documente essa premissa num
comentário em cima do mutex, dizendo que com múltiplas réplicas isso precisa
virar lock no banco. Não implemente lock distribuído nesta task.

### 2c. `reenviarPendentes` faz O(n) varreduras do condomínio inteiro

Cada `enviarMorador` chama `listarUnidades()` DUAS vezes, e cada chamada
pagina o condomínio inteiro de 50 em 50. Condomínio de 300 unidades com 300
moradores pendentes ≈ 3.600 requisições sequenciais ao ERP dentro de UMA
requisição HTTP síncrona — estoura o gateway. E se o operador reapertar o
botão depois do timeout, ele dispara a corrida do 2b em escala.

**Fazer:**
1. `reenviarPendentes` busca `listarUnidades()` **uma vez** e passa a lista
   adiante para cada `enviarMorador`, via parâmetro opcional
   (ex.: `enviarMorador(idMorador, unidadesPreCarregadas?)`). Sem a lista, o
   comportamento é o de hoje — os call sites existentes não mudam.
2. A releitura de confirmação pós-escrita **continua acontecendo** (é ela que
   prova que o contato nasceu). Só a leitura de entrada é reaproveitada.
3. Depois de um envio bem-sucedido, atualize a lista em memória com o contato
   novo, para que o próximo morador da MESMA unidade monte o payload completo.
   Sem isso o reaproveitamento reintroduz o 2b dentro do próprio laço.

**Não** adicionar parâmetro de query novo à API (Global Constraint 3).

### Testes obrigatórios

Estenda `superlogica-write.spec.ts` (já existe e mocka tudo). Cobrir:
- 2a: recusa morador sem apartamento identificável em vez de casar NULL/NULL
- 2a: usa o apartamento do vínculo `Apartamentos_Users` quando ele existe
- 2a: recusa quando há vínculo ambíguo com mais de um apartamento elegível
- 2b: dois `enviarMorador` concorrentes na mesma unidade serializam — o
  payload do segundo INCLUI o contato criado pelo primeiro (este é o teste
  que prova o fix; sem ele a task não está feita)
- 2b: envios em unidades diferentes não bloqueiam um ao outro
- 2c: `reenviarPendentes` com N moradores chama `listarUnidades` menos vezes
  que a implementação antiga (asserção sobre a contagem de chamadas do mock)
- os testes que já existem continuam passando, sem alteração de expectativa —
  se algum precisar mudar, isso é sinal de regressão: pare e reporte

### Feito quando

`npx jest --config apps/api/jest.config.cts apps/api/src/app/superlogica` verde.

---

## Task 3 — Índice único de unidade (arquivo SQL, NÃO aplicar)

**Arquivos:**
- `click-cond-web/prisma/schema.prisma`
- `click-cond-web/prisma/manual_2026-08_superlogica_unidade_unica.sql` (novo)

### O defeito

`Apartamentos.id_superlogica_uni` (schema.prisma:239) não tem restrição de
unicidade — só existe `@@unique([id_condominio, bloco, apto], map: "un_apto_cond")`.
Nada impede dois apartamentos do mesmo condomínio carregarem o mesmo
`id_superlogica_uni`. Se acontecer, o `Map` de
`superlogica-sync.service.ts:201` guarda só o último, e as cobranças daquela
unidade vão para o apartamento errado — em silêncio.

`INTEGRACAO_SUPERLOGICA.md` §6 protegeu esse invariante do lado do condomínio
(`un_cond_superlogica`) mas esqueceu do lado da unidade.

### O que fazer

1. No `schema.prisma`, no model `Apartamentos`, adicionar:
   `@@unique([id_condominio, id_superlogica_uni], map: "un_apto_superlogica")`
   com um comentário curto explicando o porquê (no tom dos comentários
   vizinhos). MySQL permite múltiplos NULL em índice único, então
   apartamentos ainda não vinculados não são afetados — diga isso no comentário.
2. Criar o `.sql` manual, **idempotente**, no mesmo padrão dos
   `manual_2026-08_superlogica*.sql` já existentes (leia um deles antes de
   escrever, e siga a forma). Ele precisa:
   - checar se o índice já existe em `information_schema.STATISTICS` antes de criar
   - trazer, comentado no topo, um `SELECT` de diagnóstico que lista
     duplicatas pré-existentes, porque se houver alguma o `CREATE UNIQUE INDEX`
     falha e o operador precisa ver quais são antes de tentar

### Constraint que domina esta task

**NÃO rodar o SQL. NÃO rodar `prisma migrate` nem `prisma db push`.**
`prisma generate` também não é necessário. O `DATABASE_URL` é produção. Esta
task entrega texto, não estado de banco. Relate explicitamente no seu report
que nada foi aplicado.

### Feito quando

Schema editado, `.sql` escrito e idempotente, nada executado contra banco.

---

## Task 4 — Corrigir o que o documento promete e o código não faz

**Arquivos:** `INTEGRACAO_SUPERLOGICA.md`, `click-cond-web/.env.example`

Num documento de segurança, prometer uma defesa que não existe é pior que não
prometer nada — alguém confia nela e para de olhar.

### 4a. Blocklist inflada (`INTEGRACAO_SUPERLOGICA.md` linha ~67)

O texto afirma que estão bloqueados `liquidar`, `estornar`, `excluir`,
`update`, `desinvalidar`, `put`, `post`, `delete`.

A `ROTAS_PROIBIDAS` real (`superlogica.client.ts:42-51`) contém apenas:
`emailcobrancasemaberto`, `notificarcomunicado`, `liquidar`, `estornar`,
`excluir`, `desinvalidar`, `desfazer`, `imprimircarta`.

`update`, `put`, `post` e `delete` **não** estão lá — e `post` não *pode*
estar, porque bloquearia a própria rota de escrita permitida `unidades/post`.

Corrija o documento para listar exatamente os termos reais, e acrescente uma
frase explicando por que `post` não está na blocklist (é a rota de escrita
permitida; quem barra escrita indevida é a allowlist separada, não a blocklist).

**Não** mexa em `ROTAS_PROIBIDAS` — a lista real está certa; é o texto que mente.

### 4b. `SUPERLOGICA_LICENCA` documentada mas nunca lida

`INTEGRACAO_SUPERLOGICA.md` §3 diz que a variável é necessária, e ela está no
`.env.example:82`. Mas `grep` no código inteiro não acha nenhum leitor: o
`baseUrl` é fixo em `'https://api.superlogica.net/v2/condor'`
(`superlogica.client.ts:76`).

Decisão: **manter a variável, corrigir a descrição**. Nenhum recurso usado
hoje mora em `<licenca>.superlogica.net`; a variável fica reservada para
quando algum passar a morar. Ajuste o texto do §3 e o comentário do
`.env.example` para dizer isso — que hoje ela não é lida por nada, e que
deixá-la vazia não quebra a integração.

### 4c. Registrar o que as Tasks 1-3 mudaram

Acrescente ao documento, nas seções que já falam desses assuntos:
- §5.2 / §6 "campo nome": que a fronteira do regex passou a ser explícita
  (`(?=\s|$)`) e por quê — com a tabela dos casos que vazavam. Deixe claro
  que a dívida de fundo (casar por texto em vez de FK `id_apartamento`)
  continua aberta.
- §7.1: que o envio agora é serializado por unidade, com a premissa de
  réplica única anotada; e que o apartamento é resolvido por ID.
- §6: o novo índice `un_apto_superlogica`, marcado como **pendente de
  aplicação** — não escreva que foi aplicado, porque não foi.
- §7 "Estado atual": mover para Implementado o que passou a existir.

Não invente resultado de teste nem diga que algo foi aplicado em produção.

### Feito quando

O documento descreve o código que existe. Nenhuma afirmação sobre banco de
produção que não seja verdade.

---

## Fora de escopo (deferido de propósito)

- **Datas em horário local** (`superlogica.client.ts:85-89` usa
  `getMonth()/getDate()` locais). Em UTC — que é o do Railway — não há drift;
  só desliza se alguém setar `TZ`. Mexer em semântica de data sem poder testar
  contra a API real é mais arriscado que o bug. Fica registrado, não corrigido.
- **FK `id_apartamento` em `Financeiro`**, aposentando de vez o casamento por
  texto. É o conserto certo do problema da Task 1, mas é migração de dados com
  backfill em cima de dinheiro real — merece plano próprio.
