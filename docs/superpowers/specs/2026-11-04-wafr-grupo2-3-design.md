# WAFR — grupos 2 e 3 (zerar HRIs para o FTR) — design

Data: 2026-11-04 · Autor: Claude (decisões próprias; usuário aprovou seguir com custo ~US$ 65/mês)

## Intenção

Depois do grupo 1 restam 7 HRIs (Security: securely-operate, identities, network-protection,
protect-data-rest, application-security; Reliability: fault-isolation, withstand-component-failures).
Zerar os 7 com mudanças reais e reenviar o FTR.

## O que cada HRI exige (sondagem `.playwright-mcp/probe.txt`) e a resposta

| HRI | Falta | Resposta |
|-----|-------|----------|
| fault-isolation | multi-AZ + bulkhead | RDS Multi-AZ; EB LoadBalanced com 2 instâncias em AZs diferentes; bulkheads de concorrência por dependência externa na API |
| withstand-component-failures | failover para recursos saudáveis | ALB tira instância doente; RDS Multi-AZ faz failover automático |
| network-protection | camadas de rede | sub-redes privadas (sem rota para internet) para o RDS; RDS sem acesso público; ALB público só aceita a prefix list do CloudFront; instâncias só aceitam o ALB |
| protect-data-rest | gestão de chaves + controle de acesso | chave KMS própria; bucket novo privado na conta 850401152034 com SSE-KMS e BPA; arquivos servidos por link assinado (reaplicar 254a6b7a via `git revert 882c7e92`) |
| identities | credenciais temporárias, segredos, IdP central, rotação | app usa só o role da instância (tirar chave click_user do EB); segredos no SSM Parameter Store (SecureString) carregados no boot; IAM Identity Center para pessoas; processo de rotação/auditoria |
| securely-operate | contas separadas, conta root protegida | AWS Organizations; MFA na root + contatos alternativos; separar workloads (ver decisão pendente) |
| application-security | pentest regular | pentest interno agora (white-box + testes dinâmicos na API própria), achados corrigidos, cadência trimestral |

## Decisões

- **Multi-instância exige app pronto antes**: tarefas agendadas (crons) passam a rodar em uma
  só instância via lock no MySQL (`GET_LOCK`); estado em memória que precisa ser compartilhado
  (ex.: ações pendentes do chat IA) vai para o banco ou fica tolerante. EB só vira LoadBalanced
  depois desse deploy.
- **Segredos**: carregador no boot lê `/prestare/api/*` do SSM e preenche `process.env` só onde a
  variável não existe (compatível com dev e com o env atual). Depois de verificado em produção, as
  variáveis migradas saem do env do EB (alivia o limite de 4096).
- **Bucket novo**: `prestare-arquivos-850401152034` (sa-east-1, SSE-KMS, BPA, versionamento).
  Migração copia por HTTPS os objetos públicos referenciados no banco (o bucket antigo continua
  público para leitura) e reescreve as URLs. Não há dados reais de clientes ainda.
- **Migrações SQL** com RDS privado: CloudShell em VPC (gratuito) nas sub-redes privadas.
- **Pentest**: feito por subagente com a skill security-audit + testes dinâmicos limitados contra
  a API de produção (sistema do próprio usuário); relatório em `docs/operacao/pentest/`.
- **Separar workloads em contas — pendente do usuário**: a conta também roda o Volti. Mover o
  Volti (ou a Prestare) para conta-membro é migração de outro sistema em produção; não faço sem
  ele decidir. Organizations, Identity Center e contatos alternativos eu adianto; MFA da root é
  o usuário (precisa do celular).

## Antimetas

- Derrubar a API: cada mudança de infra é verificada (EB verde, canary PASSED) antes da próxima.
- Perder arquivos: o bucket antigo não é apagado nem alterado.
- Marcar no WAFR algo não feito.
