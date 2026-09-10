# Financeiro pela Superlógica — estado, descobertas e plano

Documento de contexto para retomar o assunto depois. Nada aqui foi
implementado — a parte já entregue está marcada como tal, e o resto é
desenho pendente de decisão.

Origem: sessão de 10/09/2026. Inclui uma descoberta de segurança feita por
probe autorizado contra a API do ERP, que vale independente do resto.

Repositório: `c:\Users\vinic\Desktop\Click-with-Prestare`
Workspace Nx: `click-cond-web` · Branches: `master` (Railway) e `main` (Vercel)

---

## 1. O que já está no ar

Commit `519df92`, em `master` e `main`.

O financeiro do condomínio virou **somente leitura** dentro do Clique. A
trava mora no servidor: `assertFinanceiroSomenteLeitura()` em
`apps/api/src/app/auth/tenant.util.ts` substituiu `assertStaff` em 12 rotas
de mutação de `financeiro.controller.ts` (`insert`, `update`, `remove`,
`update-status`, `rateio`, `inadimplente/acordo`, `conciliacao/importar`,
`conciliacao/confirmar`, `config-auto`, `apartamento-recorrencia`,
`fechamentos/fechar`, `fechamentos/reabrir`).

As rotas continuam existindo de propósito, devolvendo 403 com texto
explicativo: o app já instalado no celular do síndico segue chamando-as até
ele atualizar, e um 404 viraria "erro de conexão" na tela dele.

Continuam escrevendo, e isso é intencional: contas pessoais do morador
(`morador/*`), os webhooks de pagamento, o job de recorrência e o sync da
Superlógica. O síndico continua podendo ver tudo, exportar CSV e notificar
inadimplente.

**Consequência assumida:** sem `update-status` não existe baixa manual.
Cobrança que não venha da Superlógica e não seja paga por Pix fica em aberto
indefinidamente. Enquanto nenhum condomínio estiver ativo na integração, o
livro caixa fica congelado. Foi decisão consciente, não efeito colateral.

---

## 2. A hipótese a construir

Todos os condomínios que a Prestare administra na Superlógica e que usarem o
Clique passam a ver **receitas e despesas vindas do ERP**. O síndico não
alimenta mais nada, nem pelo app nem pela web.

Visibilidade por papel:

| Papel | Vê |
|---|---|
| Morador | Somente receitas e despesas **já pagas / baixadas** |
| Síndico | Tudo, inclusive o que ainda não foi pago |

### Metade disso já existe

`financeiro.service.ts:948` já faz:

```ts
if (!isSindico) {
  whereClause.pago = 1;
}
```

E na linha 890, `if (!isOperador(user)) incluirTaxasCondominiais = false;` —
o servidor ignora a tentativa do cliente de ampliar o próprio recorte. A
query só pode restringir, nunca ampliar. Regra antiga, coberta por teste.

O que **não** existe é a origem dos dados: hoje receitas e despesas do livro
caixa são digitadas por gente. A Superlógica só alimenta a cobrança de taxa
de cada unidade.

---

## 3. Descobertas sobre a API da Superlógica

Padrão de URL: `https://api.superlogica.net/v2/condor/CONTROLLER/ACTION`.
O token herda as permissões do usuário que o criou — as credenciais do
`.env` autenticam como a administradora inteira, com os 17 condomínios
reais atrás.

Allowlist de leitura hoje (`superlogica.client.ts:19`): `condominios/get`,
`unidades/index`, `cobranca/index`. Nenhuma cobre despesa.

### Resultado do probe (condomínio de teste 43, somente GET)

| Rota | Resultado | Leitura |
|---|---|---|
| `despesas/index` | **HTTP 200**, `[]` | **A rota existe.** Vazio porque o condomínio de teste não tem despesa lançada — ou porque a rota não filtra e devolveu vazio por outro motivo. Não distinguido. |
| `despesa/index` | HTTP 500 | Erro de SQL citando `CONTABANCO_MOV`. É movimentação bancária, não despesa. |
| `fornecedores/index` | HTTP 200 com dado | **Ver §4 — achado de segurança.** |
| `contasapagar/index` | HTTP 404 | Não existe |
| `lancamentos/index` | HTTP 404 | Não existe |
| `movimentacaobancaria/index` | HTTP 404 | Não existe |
| `extrato/index` | HTTP 404 | Não existe |

A documentação oficial (`https://apicondominios.superlogica.com/`) é uma SPA
sem spec público; o PDF em `superlogica.com/api/api.pdf` é imagem. Os nomes
de controller não estão na web aberta — daí o probe.

---

## 4. Achado de segurança: o filtro do ERP não é confiável

Chamei `fornecedores/index` **com `idCondominio=43`**. Voltou HTTP 200 com um
contato do **condomínio 10** — um condomínio real, com nome de pessoa e
documento no campo de CPF.

Duas explicações possíveis, não distinguidas:

1. A rota espera outro nome de parâmetro (o campo no retorno se chama
   `id_condominio_cond`; a API é inconsistente entre módulos), ou
2. A rota simplesmente não filtra por condomínio.

O efeito prático é o mesmo, e é o que importa: **chamada ingênua a essa rota
entrega dado de todos os clientes da administradora.** Não é bug do Clique.

### A regra que resolve

Não confiar no filtro do ERP. Filtrar de novo do nosso lado, sempre. Cada
registro vem carimbado com o condomínio dele:

```
para cada registro recebido do ERP:
    se registro.id_condominio_cond != id_superlogica do condomínio pedido:
        descarta e conta no log
    senão:
        grava
```

Com isso, os três cenários convergem para o mesmo resultado seguro:

| Cenário | O que acontece | Risco |
|---|---|---|
| A rota filtra certo | Vem só o que interessa; a peneira não descarta nada | Nenhum |
| Nome de parâmetro errado | Vem tudo; a peneira descarta o resto | Nenhum — só banda |
| A rota não sabe filtrar | Vem tudo; a peneira descarta o resto | Nenhum — só banda |

Não existe cenário "precisa mostrar de todos os condomínios". Puxar demais é
desperdício; mostrar demais é impossível, porque a peneira roda antes da
gravação. O custo de não filtrar na origem é trafegar dado alheio por alguns
segundos — relevante para minimização (LGPD), mas categoricamente diferente
de vazar para o app de alguém.

---

## 5. O sync que já está em produção depende de proteção acidental

`superlogica-sync.service.ts:225` (`sincronizarCondominio`) **não verifica de
qual condomínio a cobrança veio**. Ele casa `id_unidade_uni` contra os
apartamentos daquele condomínio e descarta o que não casar.

Na prática isso funciona como peneira — o id de unidade de outro prédio não
bate com nenhum apartamento deste. Mas é proteção **acidental**, não
declarada: depende de os ids de unidade serem globalmente únicos no ERP e de
ninguém ter vinculado errado um `id_superlogica_uni`. O próprio código já
registra que o índice `un_apto_superlogica`, que garantiria parte disso,
**não está aplicado em produção**.

Dado o §4, isso merece virar checagem explícita. É código que já roda hoje.

---

## 6. Plano, em ordem de valor

### 6.1 Tornar explícita a peneira de condomínio no sync atual

Checagem declarada de que a cobrança pertence ao condomínio pedido, com log
do que for descartado. Testes com HTTP mockado simulando o ERP devolvendo
cobrança de outro prédio.

Pequeno, sobre código em produção, e transforma "protegido por sorte" em
"protegido por decisão". Pré-requisito conceitual de todo o resto: é a mesma
peça que vai proteger as despesas.

Antes de implementar: confirmar se o payload de `SuperlogicaCobranca`
(`superlogica.types.ts`) carrega algum campo de condomínio. Se não carregar,
a peneira precisa de outra âncora — provavelmente validar que o
`id_unidade_uni` pertence mesmo a este condomínio no ERP, não só no Clique.

### 6.2 Confirmar o que o morador enxerga hoje

A hipótese assume que o morador vê o livro caixa do prédio filtrado por
`pago = 1`. A regra existe no servidor, mas **não foi confirmado** que a tela
do morador no app (`morador_financeiro_view.dart`) mostra isso — pode ser que
ela só exiba as contas pessoais dele. Se não mostrar, a hipótese exige tela
nova e o tamanho do trabalho muda.

Meia hora de leitura de código; remove a maior incógnita do desenho.

### 6.3 Desenhar a entrada de despesas do ERP

Só depois de 6.1 e 6.2. Pontos que o desenho precisa fechar:

- **Espelhar ou ler ao vivo.** Hoje a integração espelha (copia para a tabela
  `Financeiro` com `origem='superlogica'`). Espelhar mantém o app rápido e
  offline, mas duplica dado. Ler ao vivo é sempre atual, mas fica refém da
  latência e da disponibilidade do ERP. Inclinação: **manter o espelho**, por
  coerência com o que já funciona.
- **O que é receita.** Cobrança de morador (`cobranca/index`) já entra como
  receita, mas hoje é separada do livro caixa por
  `incluirTaxasCondominiais`. Definir se a receita do ERP é a cobrança ou
  outra coisa, e o que acontece com essa separação.
- **O histórico que o síndico já lançou à mão.** Os lançamentos manuais
  existentes continuam aparecendo? Convivem com os do ERP? São marcados como
  legado? Hoje eles não podem mais ser editados nem removidos (§1).
- **Baixa.** Com o ERP dono do status, `pago` passa a vir do sync. Isso
  resolve o congelamento descrito em §1 — mas só para condomínios ativos na
  integração.
- **Toda rota nova entra na allowlist**, e isso é decisão explícita, nunca
  automática. A blocklist continua valendo por cima.

### 6.4 Opcional: confirmar o filtro de `despesas/index`

Chamar com um id inexistente (`999999`): vazio significa que filtra; dado
significa que ignora.

O script do probe vivia no scratchpad da sessão e **não persiste**. Refazer é
trivial: GET em `https://api.superlogica.net/v2/condor/despesas/index`, com
os headers `app_token` e `access_token` do `.env` e `Content-Type:
application/json` — o mesmo formato de `SuperlogicaClient.get()`. Duas
exigências ao reescrever: imprimir **só metadado** (status, contagem e os ids
de condomínio presentes, nunca nome/valor/documento), e reaplicar a blocklist
de 8 termos como segunda trava antes de disparar qualquer rota.

Melhora eficiência e minimização, **não** a segurança — quem segura o
vazamento é a peneira de 6.1.

---

## 7. Restrições permanentes

Valem para qualquer trabalho neste assunto, mesmo que a task não repita.

1. **Nenhuma escrita no ERP.** A única rota de escrita permitida é
   `unidades/post`, via `putEscritaRestrita()`, com interruptor por
   condomínio (`Condominios.superlogica_escrita`, default 0).
2. **Nenhuma chamada contra condomínio real.** Só o condomínio de teste
   "Teste Prestare Api" (id 43 no ERP) — e mesmo assim sabendo, agora, que o
   ERP pode ignorar o filtro e devolver dado alheio (§4).
3. **Preferir análise estática e teste com HTTP mockado.** É o padrão de
   `superlogica.client.spec.ts`.
4. **Nunca chutar nome de rota contra produção.** `emailcobrancasemaberto` é
   um GET de aparência inocente que dispara e-mail de cobrança real para
   moradores. A blocklist de 8 termos existe por isso.
5. **`DATABASE_URL` do `.env` é produção.** Nenhum `prisma migrate` ou
   `db push`; SQL é escrito para aplicação manual e verificada.

---

## 8. Pendência de ambiente, sem relação com o financeiro

O Flutter local foi movido de **3.47.2** para **3.41.9** (a tag que
`.github/workflows/ci.yml:65` pina), porque no 3.47 `IconData` virou classe
`final` e `phosphor_flutter` 1.4.0 e `material_design_icons_flutter` a
estendem — o app não compilava e 6 suítes de teste não rodavam.

É um adiamento, não uma solução. Em algum momento os pacotes de ícones
precisam ser atualizados (a API do phosphor 2.x mudou: `PhosphorIcons.house`
virou função, o que mexe em dezenas de telas). Para voltar ao mais novo:
`cd C:\flutter && git checkout stable`, apagando
`bin\cache\flutter_tools.snapshot` depois — o snapshot fica obsoleto na troca.
