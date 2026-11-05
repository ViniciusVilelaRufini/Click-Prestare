# Responsabilidades e escalonamento

A Prestare é uma empresa pequena. **O fundador (Vinicius Vilela) é dono de tudo**: código, infraestrutura AWS, deploy, banco, suporte a clientes, segurança e finanças. Não há plantão nem equipe; o atendimento é por e-mail e WhatsApp comercial em dias úteis. Quando houver mais pessoas, esta tabela passa a nomeá-las.

## Donos

| Item | Dono | Observação |
|---|---|---|
| Patrocinador executivo | Fundador | Decide prioridade, custo e exceções |
| Código (API, portaria-web, CRM, app, agente) | Fundador | Repo privado no GitHub |
| Conta AWS, EB, RDS, CloudFront, Amplify, Bedrock | Fundador | Conta `850401152034` (management da AWS Organizations `o-4u23300she`) |
| Acesso à AWS (Identity Center) | Fundador | Portal `https://d-946752aa07.awsapps.com/start`, usuário `vinicius`, permission set `Administrador` (sessões de 4 h). Root com MFA, sem chaves de acesso, só para emergência. Contatos alternativos (segurança, operações, cobrança) definidos. Novas pessoas entram como usuários do Identity Center com permission set de menor privilégio, nunca com usuário IAM e chave estática |
| Acesso ao banco | Fundador | Só por túnel SSM a partir do CloudShell (`runbooks.md`, seção 6) |
| Deploys e migrações | Fundador | `runbooks.md` |
| Alarmes e painel | Fundador | SNS `prestare-alertas` (e-mail do fundador) |
| Atendimento a clientes e comercial | Fundador | WhatsApp comercial e e-mail |
| Dados pessoais / LGPD | Fundador (encarregado) | `prioridades-e-governanca.md` |
| Firebase, Play Store, App Store | Fundador | Fora da AWS |

## Escalonamento técnico

1. **Fundador** age primeiro (alarme por e-mail) e resolve com os runbooks.
2. **AWS Support**: quando o problema está na infraestrutura AWS (falha de instância/AZ, RDS que não restaura, cota). Abrir caso no console; o tipo de caso disponível depende do plano de suporte contratado (no plano Basic, só conta/cobrança).
3. **Fornecedores**: Firebase/Google, provedor SMTP, Meta (WhatsApp Cloud API), GitHub, Apple/Google (lojas), conforme o componente.
4. Incidente de segurança: `plano-resposta-incidentes.md`.

Contas e papéis: sem usuários IAM com chave; deploy por OIDC (role `github-deploy-prestare`). O usuário `github-actions-deploy` está com a chave desativada.

Limitação assumida: não há segunda pessoa para cobrir a ausência do fundador; o risco é aceito e listado em `prioridades-e-governanca.md`.

## Comunicação com clientes

Canais: WhatsApp comercial (número atendido pela aba WhatsApp do CRM) e e-mail. Avisar em até 1 hora útil após confirmar impacto relevante; atualizar a cada 2 horas até normalizar; encerrar com resumo.

Aviso inicial:
> Olá, [nome]. Identificamos uma instabilidade no sistema Prestare desde [hora]. Estamos trabalhando na correção. A portaria pode precisar operar em modo manual enquanto isso. Voltamos a informar em até 2 horas.

Normalização:
> Olá, [nome]. O sistema Prestare foi normalizado às [hora]. Causa: [resumo em uma frase]. Os eventos de acesso registrados pelo agente local são reenviados automaticamente. Qualquer dúvida, estamos à disposição.

Manutenção programada (aviso com 24 h de antecedência):
> Olá, [nome]. Faremos uma manutenção no Prestare em [data], das [hora] às [hora]. Pode haver breve indisponibilidade.

## Pedidos de mudança e exceção

- Mudança em produção: passa pelo checklist de `prontidao-operacional-orr.md` e pelo deploy do workflow; migração SQL antes do push.
- Pedido de cliente que muda comportamento: o fundador decide; registrar a decisão no repo (spec/plan em `docs/superpowers/`).
- Exceção a regra de segurança ou operação (ex.: manter o bucket público): decisão do fundador, registrada com motivo e data de revisão em `prioridades-e-governanca.md`.
