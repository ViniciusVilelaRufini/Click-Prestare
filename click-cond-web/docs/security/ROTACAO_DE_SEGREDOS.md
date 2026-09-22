# Rotação de segredos

Use este runbook quando houver suspeita de exposição, desligamento de equipe ou
no ciclo operacional definido pela organização. Nunca registre valores de
segredos em tickets, commits, logs, capturas de tela ou este documento.

## Incidente: credencial exposta

Uma credencial exposta deve ser tratada como comprometida, mesmo que não haja
evidência de uso indevido. Abra o incidente e faça a rotação imediatamente:
gere um segredo novo no cofre, atualize seus consumidores, valide a transição
e revogue o valor exposto. Não mantenha a credencial exposta como rollback;
para banco, a contingência deve ser outro segredo novo, criado no cofre e com
os mesmos privilégios mínimos. Consulte `AWS_RDS_HARDENING.md` para a ordem
operacional de RDS, TLS, VPC e Security Groups.

## Preparação

1. Abra uma janela de mudança e registre os responsáveis, o ambiente e o
   plano de reversão, sem incluir valores secretos.
2. Inventarie os consumidores de cada credencial: API, agente local, jobs,
   provedores e conexões de banco.
3. Gere a nova credencial no provedor correspondente e guarde-a somente no
   cofre de segredos aprovado.
4. Atualize as variáveis de ambiente do ambiente alvo a partir do cofre; não
   use fallback no código nem arquivos versionados.

## Ordem de rotação

1. **SMTP:** crie uma nova credencial do remetente, atualize `SMTP_USER` e
   `SMTP_PASS` no cofre/deploy, reinicie a API e envie uma mensagem de teste
   para uma caixa controlada. Revogue a credencial anterior somente após a
   confirmação.
2. **Linketrack:** gere a nova chave no provedor, atualize a variável do
   conector no ambiente, valide uma consulta não destrutiva e revogue a chave
   anterior.
3. **Banco de dados:** crie uma senha nova para o usuário de aplicação com os
   mesmos privilégios mínimos, atualize a URL de conexão no cofre, faça o
   rollout da API e valide saúde e operações de leitura. Se a senha anterior
   foi exposta, revogue-a imediatamente após a validação; ela nunca permanece
   disponível para rollback.
4. **Dispositivos e agentes:** gire os tokens de agente por condomínio e os
   tokens de webhook por dispositivo. Distribua os novos tokens somente pelo
   canal operacional aprovado ou cofre local do agente; o portal e downloads
   de configuração não os retornam por HTTP. Confirme o heartbeat e só então
   invalide os anteriores. Reconfigure agentes locais que dependam do token
   antigo.
5. **Variáveis de deploy:** faça uma revisão final das variáveis de ambiente,
   removendo entradas obsoletas e confirmando que cada segredo vem do cofre.
   Reinicie ou faça rollout das réplicas afetadas para que nenhuma mantenha o
   valor anterior em memória.

## Validação e reversão

- Valide logs de inicialização e fluxos de saúde sem imprimir credenciais.
- Monitore erros de autenticação, envio de e-mail, sincronização Linketrack,
  conexões de banco e heartbeat dos agentes durante a janela definida.
- Se a nova credencial falhar, restaure temporariamente apenas a referência do
  cofre para a credencial anterior ainda válida, faça rollback do deploy se
  necessário e investigue antes de tentar nova rotação.
- Após a estabilização, revogue as credenciais antigas e registre somente
  identificadores de mudança, horário, responsáveis e resultado da validação.
