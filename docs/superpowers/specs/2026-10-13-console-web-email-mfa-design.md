# MFA por e-mail no console web — Design

**Data:** 2026-10-13
**Status:** aprovado para revisão da especificação

## Objetivo

Exigir validação em duas etapas por e-mail depois de uma senha válida no
console de portaria, sem emitir o JWT de acesso antes da confirmação. O fluxo
deve cobrir porteiros e síndicos que usam o login por senha e oferecer a opção
de confiar no navegador por 30 dias.

O login por QR Code permanece inalterado: a confirmação é feita por um celular
já autenticado, portanto ele continua sendo a segunda posse exigida para essa
modalidade.

## Contexto e decisão

O MFA atual atende o aplicativo móvel de síndico. Seus desafios e dispositivos
confiáveis são ligados exclusivamente a `Users`, enquanto o console também
autentica `Funcionarios_Portaria`. Reutilizá-lo diretamente misturaria tokens
de sessão móvel e do console, além de não atender porteiros.

Serão criados desafios e dispositivos confiáveis específicos do console web.
O fluxo móvel existente e suas rotas permanecem sem alteração. Esta separação
preserva o contrato atual do app e torna a emissão da sessão do console uma
responsabilidade explícita do fluxo de portaria.

## Escopo funcional

1. Após credenciais válidas em `POST /auth/login-portaria`, o servidor verifica
   se o navegador apresentou um dispositivo confiável ainda válido para aquela
   conta e modalidade de login.
2. Se não houver confiança válida, o servidor cria um desafio temporário,
   envia um código de seis dígitos ao e-mail cadastrado e responde somente com
   o token opaco do desafio, e-mail mascarado e prazo.
3. A tela web de MFA permite inserir o código, pedir reenvio e marcar
   “Confiar neste dispositivo por 30 dias”. Só a confirmação bem-sucedida
   recebe e persiste o JWT normal do console.
4. Se houver dispositivo confiável válido, o servidor emite a sessão normal
   diretamente, sem enviar e-mail.
5. Contas sem e-mail válido não recebem sessão por senha; a mensagem orienta
   atualizar o cadastro, sem revelar se outro login existe.

## Modelo de dados

Adicionar dois modelos Prisma e a migration correspondente.

### `Portaria_Mfa_Challenges`

Registra um desafio de uso único. Deve conter: identificador numérico, token
opaco aleatório único, `papel` (`funcionario` ou `sindico`), `id_conta`,
`login`, `id_condominio`, nome de exibição, turno, e-mail de destino, hash
bcrypt do código, contador de tentativas, expiração e datas de criação e
atualização. O token e o código nunca são gravados em texto puro.

O registro guarda o contexto mínimo de uma sessão pendente, mas a confirmação
deve consultar novamente o estado da conta e do condomínio antes de assinar o
JWT. Assim, desativação entre senha e código não permite acesso.

### `Portaria_Trusted_Devices`

Registra: identificador, `papel`, `id_conta`, hash SHA-256 do token do
dispositivo, user-agent truncado, IP, expiração, criação e última utilização.
O token bruto vai apenas ao navegador, em cookie `Secure`, `HttpOnly`,
`SameSite=Lax`, restrito ao caminho de autenticação. A tabela armazena apenas
seu hash e expira em 30 dias.

O token é rotacionado quando usado e quando um novo dispositivo é confiado.
Expiração, conta desativada ou contexto de conta diferente invalidam a
confiança. Não haverá confiança ilimitada.

## API e segurança

`POST /auth/login-portaria` passa a retornar uma união explícita:

- sessão normal somente para um dispositivo confiável válido;
- desafio `{ mfa_required, mfa_token, email_masked, expires_in_seconds }` em
  qualquer outro caso.

Novas rotas públicas, com limitação de taxa própria, serão:

- `POST /auth/portaria/mfa/verify` — recebe token de desafio, código e a opção
  de confiar; emite a sessão normal somente depois de validar o desafio e o
  estado atual da conta;
- `POST /auth/portaria/mfa/resend` — respeita intervalo mínimo de 60 segundos,
  substitui o hash do código e reinicia a validade.

O código vale 10 minutos e aceita, no máximo, cinco tentativas. Em sucesso, o
desafio é apagado antes de responder; em excesso de tentativas, também é
apagado. O fluxo usa o `MailService.sendMfaCode` existente. Erros internos de
e-mail não devem incluir detalhes do provedor na resposta HTTP.

O login por senha existente mantém rate limit e bloqueio por tentativas. A
resposta de MFA não inclui senha, JWT, e-mail completo, dados sensíveis nem
informações que permitam enumeração de contas.

## Interface web

Depois de uma resposta de desafio, a tela de login encaminha para
`/verificar-acesso` (uma rota pública). O estado mínimo do desafio fica em `sessionStorage`
durante sua validade; senha e JWT não são armazenados nele. Sem estado válido
(atualização da página após expiração, navegação direta ou aba nova), a tela
redireciona ao login.

A tela mostra o e-mail mascarado, campo numérico de seis dígitos, contador de
validade, reenvio com contagem regressiva de 60 segundos, opção de confiança e
link para voltar ao login. Após confirmar, ela usa o `AuthService` já existente
para persistir a sessão e segue para a seleção de condomínio ou dashboard.

## Casos de erro

- Credenciais inválidas, conta inativa ou condomínio inativo: resposta genérica
  de credenciais inválidas; não cria desafio.
- E-mail ausente/inválido após a senha válida: acesso recusado com orientação
  para atualizar o cadastro; não revela o endereço.
- Desafio expirado, ausente ou já usado: pedir novo login.
- Código incorreto: informar somente tentativas restantes; ao atingir o limite,
  invalidar o desafio.
- Falha de envio/reenvio: não criar/manter desafio utilizável quando nenhum
  código foi entregue; orientar tentar novamente.
- Cookie confiável inválido ou vencido: remover cookie e seguir com MFA.

## Testes e aceitação

Testes unitários de backend devem cobrir criação, expiração, tentativas,
reenvio, uso único, consulta do estado atual, dispositivo confiável, rotação e
isolamento de conta/papel. Testes do `AuthService` devem garantir que nenhuma
sessão é assinada antes do MFA quando não há confiança válida.

Testes de frontend devem cobrir a transição login → MFA, ausência/expiração do
estado, confirmação, reenvio, seleção de confiar e destino pós-login. A
verificação manual final deve usar o console no navegador: primeiro login
exige código; o segundo, no mesmo navegador, não; um navegador novo exige
código novamente.

## Fora de escopo

- Alterar o MFA do aplicativo móvel;
- alterar o QR Code;
- oferecer gerenciamento ou revogação manual de dispositivos nesta entrega;
- mudar a duração atual do JWT da portaria.
