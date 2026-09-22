# Endurecimento AWS/RDS

Este runbook descreve uma mudança operacional controlada para o banco MySQL em
RDS. Ele não altera a AWS por si só. Execute-o somente em uma janela de mudança,
com duas pessoas autorizadas, registro do ticket e acesso ao cofre de segredos.
Não inclua hostnames, usuários, senhas, certificados, exports de variáveis ou
strings de conexão em tickets, commits, logs ou capturas de tela.

## Estado de segurança e critérios de parada

- Trate a credencial de banco que foi exposta como comprometida. A rotação e a
  revogação dela são imediatas; ela não é uma opção de rollback.
- Não prossiga se o banco estiver sem backup restaurável, se não houver um dono
  operacional da mudança ou se não for possível identificar todas as cargas que
  consomem a conexão.
- Registre apenas IDs de recursos, horários, responsáveis e resultados de
  verificação. Valores de segredo permanecem exclusivamente no cofre aprovado.

## 1. Preflight, backup e plano de recuperação

1. Confirme a região, a instância, a VPC e o ambiente corretos pelo inventário,
   sem copiar detalhes sensíveis para o ticket.
2. Verifique que backups automáticos e point-in-time recovery estão habilitados,
   com retenção compatível com a política de recuperação. Crie um snapshot manual
   identificado pelo ticket antes de qualquer alteração.
3. Confirme que existe uma restauração de teste recente, ou restaure o snapshot
   em uma VPC isolada para validar integridade e o tempo de recuperação. Não
   direcione a aplicação de produção para a instância restaurada.
4. Liste API, workers, jobs, ferramentas de migração e acessos humanos que
   usam o banco. Defina responsável, janela e critério de aceitação para cada
   consumidor antes de iniciar.

**Rollback:** se o snapshot ou a restauração de teste não forem verificáveis,
pare a mudança. Nenhuma configuração de rede, parâmetro ou credencial deve ser
alterada; corrija a capacidade de recuperação e reprograme a janela.

## 2. Rede privada na VPC e Security Groups mínimos

1. Mantenha o RDS em subnets privadas de pelo menos duas zonas de disponibilidade
   e deixe a opção de acesso público desabilitada. O endpoint não pode receber
   rota de internet gateway.
2. A regra de entrada TCP na porta do MySQL deve referenciar somente o Security
   Group das cargas de aplicação autorizadas. Não use endereços amplos,
   intervalos globais ou regras abertas ao público.
3. Acesso humano ocorre por um caminho auditável, como SSM ou bastion aprovado,
   com Security Group separado e permissão temporária. Remova essa regra ao fim
   da janela e revise todos os grupos associados ao RDS.
4. Valide a partir de uma carga autorizada que a porta responde e, de uma carga
   não autorizada, que ela permanece inacessível. Não use uma origem externa
   para esse teste.

**Rollback:** se uma carga legítima perder acesso, restaure apenas a regra que
referencia o Security Group dela após confirmar sua identidade. Não reabra o
banco para a internet, nem substitua a regra por uma faixa de rede ampla.

## 3. Usuário de aplicação com least privilege e rotação

1. Gere uma senha longa e exclusiva diretamente no cofre de segredos. Nunca a
   apresente no terminal compartilhado ou a salve em arquivo local.
2. Conectado por uma sessão administrativa controlada, crie um usuário exclusivo
   da aplicação, com autenticação TLS obrigatória. Conceda somente `SELECT`,
   `INSERT`, `UPDATE`, `DELETE` e, quando o schema usar rotinas, `EXECUTE`, no
   schema da aplicação. Não conceda privilégios globais, `GRANT OPTION`, acesso
   a outros schemas nem DDL ao usuário de runtime.
3. Se migrações exigirem DDL, use uma identidade de migração distinta, com
   permissão temporária, aprovação e expiração. Ela nunca deve ser a identidade
   usada pela API em execução.
4. Atualize a referência do segredo de `DATABASE_URL` no mecanismo de deploy,
   apontando para o usuário de aplicação e sem copiar a string de conexão para
   este repositório. Faça rollout gradual e confirme saúde, leitura e escrita
   em uma entidade de teste autorizada.
5. Revogue imediatamente a senha e qualquer acesso da credencial exposta. Em
   seguida, remova a conexão administrativa das variáveis de runtime e confirme
   nos logs de conexão que a API não usa mais administrador.

**Rollback:** se o novo usuário falhar antes da revogação, corrija seus grants
de forma pontual ou interrompa o rollout. Depois que uma credencial exposta foi
revogada, não a restaure: use apenas um segredo novo de contingência, criado no
cofre e limitado ao mesmo least privilege.

### Auditoria de administrador e acesso break-glass

1. Antes de revogar qualquer conta, audite especificamente `admin@%` e outras
   contas com host curinga. Em uma sessão administrativa controlada, os comandos
   abaixo verificam a conta e seus grants sem revelar senha ou string de conexão:

   ```sql
   SELECT user, host FROM mysql.user WHERE user = 'admin' AND host = '%';
   SHOW GRANTS FOR 'admin'@'%';
   ```

2. Confirme que `admin@%` não é a conta master gerenciada pelo RDS e que todos
   os acessos administrativos legítimos foram migrados para uma identidade
   nominal e aprovada. Somente então revogue o host curinga e seu `GRANT OPTION`:

   ```sql
   REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'admin'@'%';
   DROP USER 'admin'@'%';
   ```

   Não execute esses comandos contra a conta master gerenciada pelo RDS. Para
   ela, rotacione o segredo no cofre e restrinja seu uso ao procedimento de
   emergência abaixo.

3. Mantenha uma conta administrativa break-glass distinta do usuário runtime.
   A break-glass fica em um segredo separado, com aprovação de duas pessoas,
   acesso temporário por caminho auditável e revisão posterior. Ela nunca entra
   em `DATABASE_URL`, em variáveis da API, workers, jobs ou ferramentas de
   desenvolvimento. O usuário runtime continua limitado aos grants de aplicação
   da seção anterior e não recebe `GRANT OPTION`.

**Critério de aceitação:** a auditoria não retorna `admin@%` ativo, nenhuma
identidade usada pelo runtime tem `GRANT OPTION`, e os logs mostram que somente
o usuário de aplicação abre conexões de runtime. Registre somente o resultado
aprovado e os IDs de mudança; não copie o resultado integral de `SHOW GRANTS`.

**Rollback:** não recrie `admin@%`. Caso um acesso administrativo aprovado pare
de funcionar, habilite temporariamente uma nova conta break-glass nominal, com
host privado específico, prazo de expiração e auditoria; remova-a ao encerrar o
incidente.

## 4. TLS e parâmetros do RDS

1. Distribua a CA atual do RDS pelo mecanismo seguro de deploy e configure o
   cliente para validar o certificado e o hostname, sem aceitar certificado
   autoassinado ou verificação desabilitada. A configuração de `DATABASE_URL`
   deve exigir TLS com verificação estrita da CA.
2. Faça rollout em uma réplica ou canary. Valide o handshake TLS, uma leitura e
   uma escrita autorizada sem registrar a URL ou segredo.
3. No parameter group compatível com a versão do MySQL, aplique
   `require_secure_transport=ON`. Registre se a alteração é dinâmica ou exige
   reboot e execute o reboot somente dentro da janela aprovada.
4. No mesmo parameter group, aplique `local_infile=0`. Confirme que nenhum job
   depende de carregamento local; o procedimento aprovado deve usar importação
   controlada, não reativar `local_infile` permanentemente.
5. Em uma sessão TLS autorizada, confira os valores efetivos de
   `require_secure_transport` e `local_infile`. O resultado registrado deve ser
   apenas o estado esperado, nunca dados de conexão.

**Rollback:** se o canary falhar antes da imposição, reverta somente a referência
de deploy para um segredo novo e compatível, mantendo TLS. Se uma incompatibilidade
crítica exigir desfazer `require_secure_transport`, registre aprovação de risco,
limite a duração e restaure `ON` na mesma janela. `local_infile` permanece em
`0`; uma exceção requer nova mudança, caminho isolado e aprovação explícita.

## 5. Logs, monitoramento e operação contínua

1. Habilite o slow query log no RDS com limiar aprovado e publique-o no
   CloudWatch Logs. Defina retenção, controle de acesso e alerta para erros de
   autenticação, conexões recusadas e crescimento anormal de consultas lentas.
2. Acompanhe no CloudWatch as métricas de conexões, CPU, memória, armazenamento
   livre, I/O, latência e lag de réplica quando existir. Configure alarmes com
   rota de resposta e teste a entrega para um canal controlado.
3. Revise diariamente os eventos de conexão e semanalmente os alarmes, backups,
   snapshots, retenção e o acesso ao cofre. Investigue picos sem despejar SQL,
   dados pessoais ou segredos no ticket.
4. Confirme que o usuário administrador é usado somente para emergência e
   operação controlada, nunca por API, worker, job ou ferramenta de desenvolvimento.

**Rollback:** a falha de entrega de logs ou alarmes bloqueia o encerramento da
mudança. Restaure a integração CloudWatch ou use monitoramento aprovado e
temporário antes de encerrar; não desabilite logs para reduzir ruído.

## Checklist de encerramento

- [ ] Snapshot criado e recuperação testada ou confirmada dentro da política.
- [ ] RDS privado na VPC; Security Groups restritos a identidades autorizadas.
- [ ] API usa somente usuário de aplicação de least privilege via TLS validado.
- [ ] `require_secure_transport=ON` e `local_infile=0` estão efetivos.
- [ ] Credencial exposta revogada; conexão administrativa removida do runtime.
- [ ] Backups, slow query log e alarmes CloudWatch estão ativos e verificados.
- [ ] Nenhum segredo ou string de conexão foi registrado fora do cofre.
