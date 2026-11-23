# CRM — aba Impostos (Simples Nacional)

Data: 23/11/2026

## Intenção

Ter dentro do CRM, sempre à mão, quanto a Prestare paga de imposto sobre o
controle de acesso: quanto separar no mês para o DAS, quanto sobra de cada
cliente e quanto um condomínio novo renderia líquido. O dono deixou o "como"
por minha conta.

## Objetivos

- Calcular a alíquota efetiva do Simples a partir da receita real (faturas).
- Mostrar o DAS estimado do mês e a divisão por tributo.
- Mostrar o imposto e o líquido de cada cliente.
- Simular um condomínio novo pelo número de unidades (tabela de preços do site).
- Explicar o que a Reforma Tributária muda (CBS/IBS) para quem está no Simples.

## Fora do escopo

- Lucro Presumido / Lucro Real (a Prestare fica no Simples; dá para incluir depois).
- Emissão de nota, guia DAS ou integração com a Receita/PGDAS.
- Imposto sobre venda de equipamento (terminal facial, catraca).

## Anti-objetivos

- Número que parece oficial e não é: toda tela deixa claro que é estimativa e
  que o contador confirma.
- Valores inventados: se não houver faturas, a tela diz isso em vez de mostrar zero.

## Abordagens

- **A (escolhida): aba só no CRM, cálculo no navegador.** Usa as faturas já
  carregadas pelo store e guarda a configuração no `Crm_Config` (GET/POST
  `/crm/config`, chave → valor). Sem migração e sem deploy da API.
- B: endpoint novo na API. Centraliza, mas exige deploy no EB sem ganho hoje.
- C: calculadoras da Receita (Java). Calculam nota a nota e não fazem a
  apuração anual do Simples. Descartada.

## Como funciona

**Configuração** (salva no `Crm_Config`, editável na própria aba):
- `imposto_anexo`: `fator_r` (padrão), `III` ou `V`.
- `imposto_folha_mensal`: folha + pró-labore por mês (R$), usada no Fator R.
- `imposto_inicio_atividade`: mês de início (MM/AAAA), usado na
  proporcionalização do primeiro ano.

**Cálculo** (função pura `calcularSimples`, com testes):
- RBT12 = soma das faturas emitidas (exceto canceladas) dos 12 meses
  anteriores ao mês de apuração. Com menos de 12 meses de atividade, usa a
  média mensal × 12 (LC 123, art. 18, §2º).
- Fator R = folha de 12 meses ÷ RBT12; ≥ 28% → Anexo III, abaixo → Anexo V.
- Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12,
  pelas tabelas dos Anexos III e V.
- Repartição por tributo (CPP, ISS, PIS, Cofins, IRPJ, CSLL) pela tabela de
  partilha da faixa.
- Preço do simulador: faixas progressivas do site (R$ 298 até 30 unidades;
  +R$ 9,90/un. de 31–60; +R$ 8,90 de 61–120; +R$ 11,90 acima de 120) e
  R$ 490 de implantação.

**Tela** (rota `/painel/impostos`, no menu do CRM):
1. Cartões: receita 12 meses, faixa e anexo, alíquota efetiva, DAS estimado do mês.
2. "Quanto falta para a próxima faixa" (ex.: R$ 33 mil até passar de R$ 180 mil).
3. Divisão do DAS por tributo, com a coluna "com a Reforma"
   (PIS/Cofins → CBS em 2027; ISS → IBS de 2029 a 2033; total no Simples igual).
4. Tabela por cliente: mensalidade, imposto, líquido.
5. Simulador: unidades → mensalidade, imposto, líquido; implantação à parte.
6. Painel de configuração (anexo, folha, início de atividade).

**Visão geral:** um cartão "Imposto estimado do mês" com link para a aba.

## Escolhas que ficaram comigo

- Base da receita pelo valor emitido (competência), não pelo recebido.
- Tabela de preços do site fixa no código, com comentário apontando /precos/.
- Tabelas do Simples conferidas contra a LC 123/2006 (Anexos III e V) na implementação.
