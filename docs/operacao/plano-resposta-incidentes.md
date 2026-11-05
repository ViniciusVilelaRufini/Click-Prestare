# Plano de resposta a incidentes — Prestare

Última revisão: 2026-11-04 · Dono e único responder: o fundador (Vinicius Vilela) · Revisão: semestral e após todo incidente real. Simulação (tabletop de um dos playbooks, ~1 h): a cada semestre, alternando os playbooks.

Empresa pequena: não existe plantão. O atendimento é por e-mail e WhatsApp comercial em dias úteis; alertas automáticos chegam por e-mail do tópico SNS `prestare-alertas` (ver [kpis-operacionais.md](kpis-operacionais.md) e [runbooks.md](runbooks.md)). Escalonamento e substitutos: [responsabilidades-e-escalonamento.md](responsabilidades-e-escalonamento.md).

## 1. Severidades

| Nível | Exemplo | Meta de resposta (dia útil) |
|---|---|---|
| SEV1 | Vazamento de dados pessoais; conta de produção comprometida; API fora do ar | Começar a conter em até 2 h |
| SEV2 | Degradação (erro 5xx alto, MFA/e-mail não chega, facial parado em um condomínio) | Mesmo dia |
| SEV3 | Bug sem exposição de dados | Próximo ciclo de trabalho |

Fora de horário comercial a meta é "primeira ação ao ver o alerta"; não há compromisso contratual de 24x7.

## 2. Fluxo geral

1. **Detectar**: alerta CloudWatch/SNS, canary `prestare-health`, relato de cliente (e-mail/WhatsApp), aviso da AWS, alerta do GitHub/Dependabot.
2. **Registrar**: abrir uma nota com data/hora, quem relatou, sintoma. Guardar a linha do tempo (vira o post-mortem).
3. **Conter** antes de investigar a causa (revogar chave, desativar usuário, bloquear rota).
4. **Erradicar e recuperar**: corrigir, restaurar, conferir.
5. **Comunicar**: clientes afetados e, se houver dado pessoal, ANPD e titulares (seção 4.4).
6. **Post-mortem sem culpa** em até 5 dias úteis: causa, linha do tempo, o que funcionou, ações com dono e data. Alimenta [melhoria-continua.md](melhoria-continua.md) e atualiza [modelo-de-ameacas.md](modelo-de-ameacas.md).

## 3. Onde olhar (fontes de evidência reais)

| Fonte | Para quê |
|---|---|
| Tabelas `AuditLog` e `Auditoria` (IP real, usuário, ação) | Quem fez o quê (`common/interceptors/audit.interceptor.ts`, `auditoria/auditoria.service.ts`) |
| Logs do EB no CloudWatch Logs (retenção 30 dias) | Erros da API, `[LGPD Retenção]`, falhas de storage |
| CloudTrail da conta 850401152034 | Uso de chaves e ações na AWS |
| Painel `Prestare-Operacao` | Saúde geral |
| GitHub Actions (execuções do `deploy-api.yml`) | Qual commit está em produção |
| Fila de `Mfa_Challenges` e `User_Trusted_Devices` | Atividade de MFA/dispositivos confiáveis |

## 4. Playbooks

### 4.1 Vazamento de chave (AWS, JWT, SMTP, tokens)

Sintomas: aviso da AWS (ex.: política `AWSCompromisedKeyQuarantine`), segredo achado em repositório/log/print, uso estranho no CloudTrail.

1. **Desativar** a chave no IAM (não apagar ainda — preserva a evidência). A chave `click_user` (conta 952520388262) está em quarentena da AWS e já não é usada pela API (removida do EB); tratar qualquer novo aviso do mesmo modo.
2. **Verificar uso**: CloudTrail da chave nas últimas 24–72 h (chamadas que não vieram da API ou do deploy).
3. **Rotacionar** pelo procedimento de `runbooks.md` (seção 4): atualizar o parâmetro SSM `/prestare/api/<NOME>` e reiniciar os app servers do EB (`restart-app-server`). Para o que ainda estiver como variável do EB, lembre do limite de 4096 caracteres (um acréscimo faz o `update-environment` falhar em silêncio; por isso o deploy não usa `--option-settings`): troque o valor existente e confira que a versão em produção continua a mesma.
4. Por tipo:
   - `JWT_SECRET` (`auth/jwt-secret.ts`): trocar invalida **todas** as sessões; avisar clientes que terão de logar de novo.
   - `INTERNAL_SYNC_TOKEN` (`facial/facial.controller.ts`): trocar no SSM (e reiniciar a API) e no agente local.
   - Senha SMTP: trocar no provedor e em `/prestare/api/SMTP_PASS` (`MailService`).
   - Segredo no Git: remover do histórico se aplicável, tratar o segredo como queimado mesmo com repo privado.
5. Registrar no post-mortem como o segredo vazou e como evitar (varredura de 20/10 é o precedente).

### 4.2 Conta comprometida (usuário ou admin)

Sintomas: login de IP/horário incomum em `AuditLog`, morador/síndico relata ação que não fez, MFA recebido sem o usuário ter pedido.

1. **Forçar troca de senha**: a troca grava `senha_alterada_em` e todo token anterior deixa de valer (`auth/jwt.strategy.ts`, `auth/senha-alterada.util.ts`). Para síndico, remover o dispositivo confiável (`User_Trusted_Devices`, válido 30 dias).
2. Porteiro/funcionário comprometido: remover o acesso (revogação coberta por `auth/revogacao-porteiro-removido.spec.ts`).
3. Admin do CRM: trocar a senha em `crm_admins` (bcrypt) e revisar o que foi alterado em condomínios (`crm/crm-condominios.service.ts`; desativação/reativação ficam auditadas como `DEACTIVATE`/`REACTIVATE`).
4. Levantar o que a conta fez no período em `AuditLog`/`Auditoria` por usuário e IP; reverter alterações indevidas.
5. Se a conta acessou dados pessoais de terceiros, seguir 4.4.
6. Conta AWS (Identity Center, root ou IAM): encerrar as sessões do usuário no Identity Center, trocar a senha, revisar o MFA, listar chaves e usuários criados (não deve haver chave de acesso ativa) e checar o CloudTrail.

### 4.3 Indisponibilidade

Sintomas: alarme de saúde do EB, 5xx no CloudFront, canary `prestare-health` falhando, cliente sem conseguir logar.

1. Confirmar de fora: `https://api.prestarecondominios.com.br/api/health` (via CloudFront) e a página `/sobre`.
2. Classificar: aplicação (deploy ruim, exceção, 503 de bulkhead por provedor lento), instâncias (CPU/memória, `StatusCheckFailed`, targets do ALB), banco (conexões/armazenamento/CPU do RDS), dependência externa (Bedrock/SMTP/Superlógica) ou AWS.
3. Se começou após um deploy: voltar a versão anterior do EB (versões `api-<sha>` do `deploy-api.yml` e `v-<run>-<sha>` do `ci.yml` ficam no bucket do EB; ver `runbooks.md`, seção 2). Conferir com o passo de verificação de versão.
4. Instância travada: reiniciar o servidor de aplicação do ambiente; persistindo, reconstruir o ambiente.
5. Banco: ver [plano-recuperacao-desastre.md](plano-recuperacao-desastre.md) (RTO 4 h / RPO 24 h para erro lógico; Multi-AZ cobre falha de zona; restauração por snapshot ou PITR).
6. Lembrar: o ambiente tem 2 a 4 instâncias em duas zonas atrás de um ALB e o RDS é Multi-AZ; falha de uma zona é absorvida sozinha. Falha da região inteira não tem cobertura automática (risco aceito).
7. Impacto na portaria: o agente local reenvia eventos offline com deduplicação; a portaria física continua com os dispositivos na LAN. Avisar o condomínio por WhatsApp/e-mail.

### 4.4 Vazamento de dados pessoais (LGPD)

Gatilhos: foto/documento/biometria acessados por quem não devia, bucket exposto indevidamente, export com dados de outro condomínio, conta comprometida (4.2) que leu dados de terceiros.

1. **Conter**: bloquear o acesso (revogar conta/chave; se for objeto no bucket, remover o objeto com `StorageService.deleteUrl` ou direto no bucket `prestare-arquivos-850401152034` (versionamento ligado: apagar também a versão, se for o caso); se for bug de isolamento, desligar a rota).
2. **Dimensionar**: quais titulares (moradores, visitantes, funcionários), quais dados (biometria e documento são os mais graves), qual condomínio, de quando a quando. Fontes: `AuditLog`, logs do EB, CloudTrail, logs de acesso do bucket (se existirem).
3. **Avaliar risco ao titular** (art. 48 da LGPD). Dado biométrico ou documento exposto presume risco relevante.
4. **Comunicar**:
   - Operador/controlador: o condomínio (controlador) é avisado pelo fundador imediatamente, por e-mail e WhatsApp, com o resumo de 2.
   - ANPD e titulares: a decisão cabe ao controlador, com apoio do fundador; o prazo regulamentar é de 3 dias úteis a partir da ciência (Resolução CD/ANPD nº 15/2024 — confirmar o texto vigente na hora).
   - Conteúdo mínimo: natureza dos dados, titulares afetados, medidas tomadas, riscos, contato.
5. **Corrigir a causa** e registrar no post-mortem; acrescentar teste automatizado que impeça a recorrência (padrão dos `*.spec.ts` do `auth/`).
6. Guardar evidências e a linha do tempo por no mínimo 5 anos.

Situação atual do risco: desde 2026-11-04 as fotos ficam em bucket privado e são entregues por URL assinada de até 1 h; uma URL vazada deixa de valer em até 1 h. O bucket público antigo (`storage-click-dev`, outra conta) ainda existe até ser desativado. Ver riscos pendentes.

## 5. Contatos e ferramentas (sem segredos)

- Responder único: fundador. E-mail de alertas: tópico SNS `prestare-alertas`.
- AWS: console na conta 850401152034, região sa-east-1; AWS Support conforme plano contratado.
- Clientes: e-mail e WhatsApp comercial (aba WhatsApp do CRM).
- Credenciais e números ficam no gerenciador de senhas do fundador, **não** neste repositório.

## 6. Riscos aceitos / pendentes

- Pessoa única: sem substituto operacional, sem plantão 24x7. Mitigação: alarmes por e-mail e runbooks escritos; a decisão de contratar apoio é revisada a cada trimestre.
- Logs da aplicação retidos por 30 dias; incidente descoberto depois disso fica sem evidência de aplicação (CloudTrail e auditoria no banco permanecem).
- Bucket antigo `storage-click-dev` e chave `click_user` em quarentena (conta 952520388262) ainda existem; um incidente relacionado a eles depende de acesso àquela conta. Desde 2026-11-05 o Volti/Voltz roda na conta própria 117153693161; na 850401152034 restam só sobras aposentadas e paradas, e a conta também é a de gerenciamento da Organization.
- Revogação individual de sessão do app não existe (JWT de 365 dias); a mitigação é a troca de senha.
- Sem cópia entre regiões: falha regional exige recuperação manual.
- O plano nunca foi exercitado ponta a ponta; o primeiro tabletop está previsto para o próximo trimestre.
