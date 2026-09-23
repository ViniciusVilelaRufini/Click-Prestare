# Integridade dos eventos de acesso + base limpa

**Data:** 2026-09-20
**Sub-projeto 1 de 3.** Os sub-projetos 2 (consolidar `Moradores`/`Apartamentos_Users`) e 3 (separar `Pessoas`/`Visitas`) têm specs próprios e dependem deste.

## Problema

`Acessos_Facial` é o log de quem passou por qual porta e quando — a memória do controle de acesso físico. O banco não garante quase nada sobre ele, então a correção depende inteiramente de o código acertar em todos os caminhos.

Medido no RDS de produção em 19/09/2026 (base de teste, 472 eventos):

| Sintoma | Quantidade | Causa |
|---|---|---|
| Eventos apontando para dispositivo inexistente | **185 de 472 (39%)** | `id_device` é um inteiro solto, sem FK |
| Eventos apontando para visitante inexistente | 262 de 472 | referência polimórfica, sem FK possível |
| Eventos gravados no condomínio errado | 0 | — (correto hoje, mas por acerto do código) |

Nos 185, a pergunta "por qual porta essa pessoa passou?" não tem mais resposta. O condomínio existe com 1 dispositivo cadastrado; os eventos citam os ids 1 a 6, dos quais só o 6 sobrevive.

Além disso, `Acessos_Facial → Condominios` é `ON DELETE CASCADE`: apagar um condomínio destrói todo o seu histórico de acesso — justamente a prova que serviria num incidente de segurança.

## Decisões

### D1 — Snapshot do dispositivo na linha do evento

Nova coluna `nome_dispositivo VARCHAR(100) NULL` em `Acessos_Facial`, preenchida na gravação a partir de `Facial_Devices.nome`.

Segue o padrão que a tabela já usa para pessoas: `nome_pessoa` é gravado junto do `id_pessoa` exatamente para que o log continue legível quando a pessoa deixar de existir. Log de auditoria deve preservar o que foi observado no momento, não depender de join com o estado atual.

Nullable porque eventos antigos não terão o valor — e após o wipe não haverá eventos antigos, mas a coluna permanece tolerante.

### D2 — FK em `id_device`, `ON DELETE RESTRICT`

`Acessos_Facial.id_device` passa a referenciar `Facial_Devices(id)`.

`RESTRICT` e não `CASCADE`: apagar um terminal não pode apagar o histórico de quem passou por ele. Apagar um aparelho com eventos passa a falhar explicitamente — o operador decide o que fazer, em vez de descobrir depois que o log sumiu.

Com D1 no lugar, o evento continua dizendo qual era o aparelho mesmo que a FK bloqueie a remoção.

### D3 — `Acessos_Facial → Condominios` de `CASCADE` para `RESTRICT`

Remover um condomínio passa a ser operação de dois passos: expurgar o histórico explicitamente, depois remover. Destruir log de acesso vira ato deliberado em vez de efeito colateral.

### D4 — `id_condominio` do evento derivado do dispositivo

Em `facial.service.ts`, o `id_condominio` gravado no evento passa a vir de `Facial_Devices.id_condominio`, não do chamador.

Hoje não há divergência nos 472 eventos, mas a coerência é garantida pelo código e não pela estrutura. Derivar da fonte elimina a classe inteira: um evento não pode aparecer no relatório do condomínio errado porque não há como informar um condomínio diferente do aparelho.

### D5 — `Visitantes → Apartamentos` permanece `CASCADE`

Levantado na auditoria como defeito, **descartado no desenho**. Com D1 e o `nome_pessoa` já existente, o evento de acesso permanece legível sem o visitante. Trocar para `RESTRICT` bloquearia uma operação legítima (síndico removendo um apartamento) em troca de nenhum ganho de auditoria.

### D6 — Wipe da base de teste

Não existe cliente real; todo dado em produção é teste. O wipe entrega base limpa para o primeiro cliente e, de quebra, é pré-requisito técnico: as constraints de D2 não podem ser criadas sobre os 185 eventos órfãos.

**Apagado:** condomínios, apartamentos, moradores, visitantes, eventos de acesso, vagas, veículos, tags, dispositivos faciais, prestadores, convites, e dependentes por cascata.

**Preservado:** estrutura de tabelas, `Planos`, e `Users` — apagar contas removeria o próprio acesso do operador.

**Salvaguardas:** dump completo salvo fora do banco antes de qualquer DELETE; confirmação explícita do operador no momento da execução.

## Ordem de execução

A sequência é obrigatória — D2 falha se executada antes do wipe.

1. Dump completo (fora do banco)
2. Wipe dos dados
3. DDL das constraints (D1, D2, D3)
4. `prisma/schema.prisma` refletindo o banco
5. Código do gravador (D1, D4)
6. Testes

## Escopo negativo

Não faz parte deste sub-projeto: consolidar `Moradores`/`Apartamentos_Users` (sub-projeto 2), separar `Pessoas`/`Visitas` (sub-projeto 3), a referência polimórfica pessoa↔evento (sem FK possível; mitigada pelo snapshot `nome_pessoa` já existente), e os achados de segurança pendentes da revisão de 19/09 (`/health`, HTTP CloudFront→EB, SQL do Express, rate limit de login, MD5, Face ID).

## Verificação

- Gravar evento com dispositivo de outro condomínio que o informado → o evento registra o condomínio do **dispositivo**
- Gravar evento → `nome_dispositivo` preenchido com o nome do aparelho
- Gravar evento com `id_device` inexistente → recusado pelo banco
- Apagar dispositivo com eventos → recusado
- Apagar condomínio com eventos → recusado
- Apagar apartamento com visitantes → permitido, e os eventos daqueles visitantes continuam legíveis (`nome_pessoa` e `nome_dispositivo` intactos)
- Suíte existente segue verde (baseline: 112 suites / 1037 testes)

## Restrições globais

- Schema neste projeto é SQL escrito à mão: não há `prisma/migrations/` nem script de migração. Toda DDL vai em arquivo versionado e é aplicada manualmente.
- O `prisma/schema.prisma` deve refletir exatamente o banco após a DDL.
- `DATABASE_URL` do `.env` aponta para **produção** (RDS). Não existe banco local.
- Nenhum push nem merge para `master` — o trabalho fica na branch `fix/integridade-dados`.
- Nenhum DELETE sem o dump concluído e verificado antes.
