# Prioridades e governança

Dono: o fundador, que também é o patrocinador executivo.

## Partes interessadas

| Parte | Interesse principal |
|---|---|
| Clientes externos: síndicos, administradoras, condomínios | Acesso funcionando, privacidade dos moradores, suporte rápido |
| Usuários finais: porteiros, moradores, funcionários | App e portaria rápidos e simples |
| Titulares de dados (LGPD) | Tratamento mínimo; fotos e documentos protegidos |
| Interno: fundador | Custo baixo, pouco trabalho operacional, produto evoluindo |
| Parceiros e fornecedores: AWS (inclui Marketplace), Superlógica, Firebase | Contratos e integrações estáveis |

## Ordem de prioridade (em caso de conflito)

1. Segurança e privacidade dos dados de moradores (LGPD).
2. Disponibilidade da portaria e do registro de acessos.
3. Integridade dos dados.
4. Correção de defeitos que travam o cliente.
5. Novas funcionalidades.
6. Otimização de custo (sem comprometer 1 a 3).

## LGPD

- Controlador e encarregado: o fundador. Classificação e retenção em `classificacao-e-retencao-de-dados.md`.
- Expurgo de fotos implementado em `click-cond-web/apps/api/src/app/common/storage/storage.service.ts` (`deleteUrl`, prefixos `PREFIXOS_FOTO_*`); documentos de visitante são mascarados na interface.
- Hoje o banco só tem dados de teste; os controles valem desde já para produção.

## Governança

- Mudanças de produção: push em `master` e `main`, deploy automatizado e verificação pós-deploy.
- Decisões relevantes registradas em `docs/superpowers/specs` e `docs/superpowers/plans`.
- Revisão mensal de KPIs, cotas, riscos e drift (`melhoria-continua.md`).
- AWS FTR (Foundational Technical Review) da solução Prestare (`soln-gj5pqrsf4g2sa`): **aprovada em 2026-11-05**, com o relatório WAFR (0 riscos altos em Segurança, Confiabilidade e Excelência Operacional). Marco "FTR 2026-11-05" no workload WAFR `5cd98629da19185f4c9fd144f19ff30e`. A FTR expira em **2028-11-03**: revalidar (rodar de novo o WAFR) antes dessa data; ver `melhoria-continua.md`.
- Controles de segurança: `objetivos-de-controle.md`; ameaças: `modelo-de-ameacas.md`.

## Riscos abertos e aceitos (revisar mensalmente)

| Risco | Situação |
|---|---|
| Cargas não separadas em contas AWS distintas (Volti/Voltz) | **Resolvido em 2026-11-05**: Volti e Voltz migrados para a conta-membro 117153693161 (Organization o-4u23300she). Ponto de melhoria restante: o Prestare fica na 850401152034, que também é a conta de gerenciamento (não é risco alto) |
| Sobras do Volti/Voltz na 850401152034 | Paradas, com backup final, a excluir após a janela de verificação: EC2 `i-0fe5328a27dc50798` (parada), RDS `voltz-postgres` (parado; snapshot final `voltz-postgres-final-20261105`), ambiente EB do Voltz com escala 0, pools Cognito e buckets antigos, e a distribuição CloudFront `E7141MRA5JPV3`, mantida só como ponte de redirecionamento para builds do app Voltz já instalados (origens apontam para `voltz.prestarecondominios.com.br` na conta nova) |
| DNS do Volti/Voltz | As subzonas `api-volti-dev.prestarecondominios.com.br` e `voltz.prestarecondominios.com.br` estão delegadas (registros NS na zona do Prestare) para a conta nova; a zona do Prestare mantém só as delegações NS |
| Provedor OIDC do GitHub (role `github-deploy-prestare`) | Foi criado pela stack CloudFormation do Voltz e agora tem DeletionPolicy Retain; após a exclusão dessa stack passa a pertencer ao Prestare |
| Cadastro sem verificação de e-mail (causa raiz do P-01 do pentest) | Aberto; resolver antes do primeiro cliente real |
| Sem cópia entre regiões (banco e arquivos) | Aceito até haver clientes reais |
| Bucket antigo `storage-click-dev` (outra conta) ainda público; `database-1-antigo` parado | A desativar/excluir; decidir `database-1-antigo` até 2026-11-11 |
| Senha SMTP | Agora no SSM; confirmar a troca no provedor |
| Resolvidos em 2026-11-04 | Single-AZ (ALB + ASG 2-4, RDS Multi-AZ privado); segredos no SSM; bucket privado com URL assinada; chave `click_user` fora do EB; chaves estáticas de deploy desativadas; IAM Identity Center ativo |
| Dependência de uma só pessoa | Aceito; a documentação desta pasta mitiga |
