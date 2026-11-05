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
- Controles de segurança: `objetivos-de-controle.md`; ameaças: `modelo-de-ameacas.md`.

## Riscos abertos e aceitos (revisar mensalmente)

| Risco | Situação |
|---|---|
| Cargas não separadas em contas AWS distintas (a conta também hospeda o projeto Volti) | Aberto; decisão do fundador pendente (Organizations já criada) |
| Cadastro sem verificação de e-mail (causa raiz do P-01 do pentest) | Aberto; resolver antes do primeiro cliente real |
| Sem cópia entre regiões (banco e arquivos) | Aceito até haver clientes reais |
| Bucket antigo `storage-click-dev` (outra conta) ainda público; `database-1-antigo` parado | A desativar/excluir; decidir `database-1-antigo` até 2026-11-11 |
| Senha SMTP | Agora no SSM; confirmar a troca no provedor |
| Resolvidos em 2026-11-04 | Single-AZ (ALB + ASG 2-4, RDS Multi-AZ privado); segredos no SSM; bucket privado com URL assinada; chave `click_user` fora do EB; chaves estáticas de deploy desativadas; IAM Identity Center ativo |
| Dependência de uma só pessoa | Aceito; a documentação desta pasta mitiga |
