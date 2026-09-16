# Plano de prontidão para uso comercial

Levantado na auditoria de 30/07/2026. Serve como ponto de partida para as
próximas rodadas de trabalho — cada item diz **o que é**, **por que importa** e
**como saber que terminou**.

> **Veredito curto:** dá para colocar **um** cliente escolhido a dedo hoje, com
> o síndico sabendo que é início. Para vários clientes pagantes, faltam os
> bloqueadores 1 a 4 abaixo.

---

## O padrão que explica quase tudo

Três áreas foram auditadas a fundo (Finanças, Visitantes/Prestadores,
Moradores/Apartamentos) e **as três** tinham a mesma classe de falha:

> **A autorização estava na tela, não no servidor.** O botão some para quem não
> pode, mas a rota aceita a chamada.

Junto com ela, dois hábitos que se repetiram:

- **lógica duplicada que divergiu** — duas implementações da mesma operação, uma
  corrigida e a outra não (exclusão de apartamento, identidade de pessoa);
- **`catch` que troca o erro real por "não encontrado"** — apareceu em 6 lugares
  e escondia violação de chave estrangeira e falha de banco.

O que preocupa não é a quantidade de bugs, é a **taxa**: 3 de 3 áreas. Os
módulos ainda não auditados provavelmente têm o mesmo padrão. É isso que o
bloqueador 1 endereça.

---

## Bloqueadores para uso comercial

### 1. Varrer os módulos ainda não auditados

**Estado:** 3 de ~20 módulos auditados.

Já cobertos: `financeiro`, `visitantes`, `prestadores`, `moradores`,
`apartamentos`, e parcialmente `auth` e `chat-ia`.

Faltam, em ordem de risco:

| Prioridade | Módulo | Por quê |
|---|---|---|
| **Alta** | `facial`, `caminhos-acesso`, `regras-acesso`, agente local | É o único lugar onde um bug **abre uma porta física**. Tem superfície incomum: `/facial/internal/sync` com token interno, replay offline, sincronização de várias tabelas de pessoas. |
| Alta | `areas-sociais` | Reservas com facial por reserva; lógica de ocupação e conflito de horário. |
| Média | `assembleias` | Integridade de voto (um por unidade, quórum) tem peso jurídico. |
| Média | `documentos`, `comunicados` | Podem conter ata, contrato, dado pessoal. |
| Média | `encomendas`, `ocorrencias`, `mudancas`, `veiculos` | Vazamento constrangedor, não grave. |
| Baixa | `agenda`, `dashboard`, `relatorios` | Superfície menor; `relatorios` já recebeu checagem de papel. |

**Roteiro que funcionou** (reaproveitar):

1. Listar as rotas do controller e marcar quais têm checagem de **papel**
   (`assertOperador` / `assertStaff` / `assertSindico`) — não só de tenant.
   O `TenantGuard` protege o condomínio, mas **morador pertence ao condomínio**.
2. Cruzar cada método público do service com o helper de autorização que
   deveria usar. Método sem `payload` no parâmetro é o sinal mais forte.
3. Conferir quem o **app** chama de verdade antes de trancar uma rota
   (`grep -rn "'/rota" click-cond-app/.../lib/controllers/`).
4. Procurar `catch {` sem uso do erro, e `this.service.X(...)` sem `await`.

**Pronto quando:** todo módulo da tabela tiver sido percorrido e cada rota de
console tiver checagem de papel explícita ou uma justificativa escrita.

---

### 2. CI — hoje não existe nenhum

**Estado:** sem `.github/workflows`. Os 446 testes só rodam quando alguém lembra.

O `nx build` usa webpack e **não faz type-check estrito**: nesta auditoria ele
aceitou calado dois erros reais que o `tsc` pegou.

**O que fazer:**

1. Workflow que roda em push e PR: `nx test api`, `nx build api`,
   `nx build portaria-web`, `flutter test`.
2. `nx typecheck api` (alvo já criado) **ainda não serve como gate**: acusa
   **59 erros pré-existentes** fora das áreas auditadas. Limpar primeiro —
   33 são o mesmo `TS1272` (`import type` em assinatura decorada) e 6 são
   variáveis não usadas, então ~2/3 é mecânico.
3. Depois de limpo, tornar o typecheck bloqueante.

**Pronto quando:** um push com teste quebrado ou erro de tipo falha antes do
deploy do Railway.

---

### 3. OpenPix com credencial única — bloqueio comercial

**Estado:** `OPENPIX_APP_ID` é uma env global. **Todo Pix de todo condomínio cai
na mesma conta.**

A `chave_pix` manual já é por condomínio (coluna em `Condominios`), mas o Pix
automático não. Não dá para atender dois clientes assim — o dinheiro do
condomínio A e do B chegam no mesmo lugar.

**O que fazer:** mover a credencial para o condomínio (coluna nova + migração
SQL manual, ver `DEPLOY_FINANCEIRO.md`) e passar a resolvê-la por
`id_condominio` no `OpenPixService`.

**Pronto quando:** dois condomínios com contas OpenPix distintas geram cobrança
e cada webhook confirma na conta certa.

---

### 4. Senhas legadas em MD5

**Estado medido em produção (30/07/2026):**

- `Users`: 435 total — **250 já em bcrypt, 157 ainda em MD5**, 28 sem senha
- `Funcionarios_Portaria`: 24 total — 23 em bcrypt, 1 em MD5

Todas as **escritas** já foram convertidas para bcrypt nesta auditoria, e o
login migra o hash legado no acesso. Mas quem **não logar** continua com MD5 sem
sal indefinidamente — e a senha inicial são os dígitos do documento, que é
reversível por força bruta em segundos.

**O que fazer:** forçar redefinição para os 157, ou expirar a senha legada e
mandar pelo fluxo de recuperação (que já grava bcrypt).

**Pronto quando:** a consulta abaixo devolver 0 legados.

```sql
SELECT COUNT(*) FROM Users WHERE password IS NOT NULL AND password NOT LIKE '$2%';
```

---

## Fora do código

### 5. LGPD e Play Console

O sistema guarda CPF, foto e **biometria facial**. Biometria é **dado sensível**
sob a LGPD, com exigências mais duras: base legal específica, consentimento
informado, política clara de retenção e exclusão.

As pendências da Play Console que já estão na lista — política de privacidade do
reconhecimento facial, Data Safety, URL de exclusão de conta — são a mesma
questão por outro ângulo.

**Isso não se corrige com deploy.** Antes de vender para condomínio de terceiro,
precisa estar resolvido: o risco é jurídico.

---

## Dívidas menores (não bloqueiam, mas incomodam)

- **Livro caixa sem as taxas condominiais.** A tela e o CSV excluem as cobranças
  de apartamento de propósito (elas vivem na Inadimplência), então a prestação de
  contas sai com despesas e sem arrecadação. Decisão de produto pendente — ver
  [`memory/financeiro-decisoes-pendentes`].
- **Regra do funcionário divergente.** Em visitantes, funcionário era tratado
  como morador (restrito aos apartamentos dele — e a maioria não tem nenhum).
  Foi alinhado com os flags de permissão da ficha (`cadastrar_visitante`,
  `prestadores_servico`), que o servidor passou a honrar. Vale conferir se os
  demais módulos usam os flags que já existem na tabela `Funcionarios`.
- **Fixtures de teste fora de sincronia.** Os specs constroem o
  `MobileAuthService` com menos argumentos do que o construtor pede — as
  dependências extras chegam `undefined`. Funciona porque nenhum teste exercita
  esses caminhos, mas é uma armadilha para quem escrever o próximo.
- **Duplicação de fonte de verdade.** `Moradores` (legado, apartamento como
  texto) e `Apartamentos_Users` (relacional) convivem. Todo isolamento resolve
  pela segunda; vários módulos precisam consultar as duas. Consolidar reduziria
  uma classe inteira de bug.

---

## O que já foi feito (não refazer)

Auditoria de 29–30/07/2026, tudo em produção:

**Finanças** (`3862bca`) — morador podia apagar a própria dívida pela API;
contas pessoais vazavam no CSV, no relatório e na conciliação; relatório
financeiro do prédio aberto a qualquer morador; editar lançamento com centavos
multiplicava o valor por 100; deploy no dia da geração pulava o mês inteiro de
faturamento; conciliação OFX sugeria a mesma cobrança para todas as transações
de valor igual; dívida renegociada contava em dobro.

**Visitantes e prestadores** (`162a0fa`, `560fb7d`, `aff2b96`) — console
alcançável por morador; morador editava prestador do vizinho; redirecionava a
própria visita para a unidade do vizinho; permissões de funcionário passaram a
valer no servidor; exclusão de visitante travava por vaga de garagem; o botão de
excluir visitante do app nunca funcionou (rota inexistente).

**Moradores e apartamentos** (`194696a`) — `link-user` sem autorização nenhuma
(escalação para qualquer apartamento); console inteiro sem checagem de papel;
listagem revelava quem mora onde; senhas passaram a ser gravadas em bcrypt;
exclusão de apartamento ganhou contagem da cascata e auditoria.

**Números:** 446 testes / 53 suítes (eram 288 no início). Nenhuma migração SQL
foi necessária em nenhuma das três.
