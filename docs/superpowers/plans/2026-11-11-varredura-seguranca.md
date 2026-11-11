# Varredura de segurança 11/11/2026 — plano de correção

Origem: duas auditorias somente leitura feitas em 11/11/2026 (superfície do app
móvel; rotas públicas, arquivos, chat de IA, CRM/financeiro). Os achados
críticos foram reconfirmados no código pelo controlador antes deste plano.
Pedido do dono: "pense, ache, arrume, teste" em ciclo, sem publicar sem ele.

## Global Constraints

- Repositório `click-cond-web` (Nx). API NestJS em `apps/api`, Prisma + MySQL.
  Caminhos abaixo relativos a `click-cond-web/apps/api/src/app/`.
- NÃO alterar `prisma/schema.prisma` nem exigir SQL (nenhuma coluna/tabela
  nova). Estado volátil compartilhado entre instâncias usa o
  `EstadoCompartilhado` que já existe no projeto.
- TDD: cada correção começa por um teste que falha pelo motivo certo.
- Testes: Jest 30, filtro `--testPathPatterns` (plural):
  `npx nx test api --skip-nx-cache --testPathPatterns="<padrão>"`.
  Typecheck: `npx nx run api:typecheck --skip-nx-cache`.
- Mensagens ao usuário em português, sem detalhe interno (Prisma, SMTP, stack).
- Não mudar contrato de resposta que o app em produção consome, exceto
  removendo campos sensíveis listados na tarefa.
- O app móvel em produção usa `auth/mobile-auth.controller.ts` +
  `auth/mobile-auth.service.ts`; o console web usa os controllers de cada
  módulo. Uma correção de regra de negócio vale para as duas superfícies
  quando a tarefa disser.

## Task 1 — Edição por terceiros não pode trocar credenciais da conta

Achado (VERIFICADO): `auth/mobile-auth.service.ts` ~3783-3863 (`saveMorador`,
ramo de edição). Um funcionário ou síndico (`assertStaff`) edita o morador de
outra pessoa e o patch de `Users` troca `email`/`login`/`cpf`. A trava atual
(`common/vinculos-usuario.util.ts`, `usuarioTemVinculoEmOutroCondominio`) só
age quando a vítima tem vínculo em OUTRO condomínio. Cenário: funcionário troca
o e-mail de login do morador (ou do síndico que mora no prédio) para o próprio,
pede "esqueci a senha" e assume a conta por 365 dias. O mesmo padrão existe no
console: `moradores/moradores.service.ts` ~1104-1129.

Fazer:
1. Quando quem edita NÃO é o titular da conta (`atual.id_user !== callerId`),
   nunca gravar `email`, `login` nem `cpf` em `Users` — em nenhuma hipótese,
   não só com vínculo em outro condomínio. Os campos continuam sendo gravados
   em `Moradores` (cadastro do condomínio). Nome, telefone e foto seguem como
   hoje. Aplicar nas duas superfícies (app e console).
2. Autoedição de credenciais exige a senha atual: `updateSindico` (~389-479),
   `updateInfosFuncionario` (~3269-3349) e a autoedição em `saveMorador`
   passam a recusar a troca de `email`/`login` sem `senha_atual` correta
   (mesma conferência que `new-password` já faz — reutilize). Sem troca de
   e-mail/login, nada muda para o usuário. Mensagem: "Para trocar o e-mail de
   acesso, informe sua senha atual."
3. `updateSindico` grava `cpf: null` e `phone: null` quando o campo não vem no
   corpo (~435-436, ~452-453): só gravar campos presentes.
Testes: funcionário edita morador do mesmo prédio trocando e-mail → `Users`
inalterado e `Moradores` atualizado; síndico morador idem; titular troca o
próprio e-mail sem senha → 400; com senha certa → grava; `updateSindico` sem
cpf/phone não apaga.

## Task 2 — 2º fator do síndico e logins com filtro injetável

Achado (VERIFICADO): `auth/mfa/mfa.service.ts` `verify` (~99-110) e `resend`
(~180-222); rotas públicas em `auth/mfa/mfa.controller.ts`. `mfa_token` chega
sem conferência de tipo e vai direto ao `where` do Prisma (um objeto como
`{"startsWith":"a"}` vira filtro). `resend` não exige desafio válido, zera
`tentativas` e estende a validade — palpites ilimitados. Desafios vencidos nunca
são apagados. O erro cru do SMTP volta ao cliente (~76-78, ~239-242).
Mesmo filtro injetável em `crm/crm-auth.service.ts` `login` (~24-26) e em
`loginSindico` (`auth/mobile-auth.service.ts` ~172).

Fazer:
1. `mfa_token` (verify e resend) e `code` só como string; `mfa_token` no
   formato que o próprio serviço gera (confira como é gerado e valide com
   regex equivalente); fora disso → 400 genérico, sem consultar o banco.
2. `resend`: exige `expires_at > agora`; NÃO zera `tentativas`; teto de
   reenvios por desafio (3) — guardar o contador sem coluna nova (se o modelo
   `Mfa_Challenges` já tiver campo utilizável, use; senão `EstadoCompartilhado`
   com chave por desafio e validade igual à do desafio).
3. Esgotadas as tentativas, o desafio é apagado (exige novo login com senha).
4. `@Throttle` próprio nas duas rotas: 10 por 10 minutos por IP.
5. Limpeza: ao criar um desafio, apagar os vencidos do mesmo usuário.
6. Mensagens de erro de envio de e-mail genéricas ("Não foi possível enviar o
   código agora. Tente novamente em instantes."), detalhe só no log.
7. `crm-auth.service.ts` `login` e `loginSindico`: login/senha só como string
   (mesmo padrão de `loginPortaria` em `auth/auth.service.ts` ~277).
Testes: objeto em `mfa_token` → 400 sem chamada ao Prisma; resend de desafio
vencido → recusa; resend não zera tentativas; quarto resend → recusa; 6ª
tentativa errada → desafio apagado; login CRM/síndico com objeto → 400/401 sem
consulta.

## Task 3 — Identidade de terceiros revelada pelo CPF na visita

Achado (VERIFICADO): `visitantes/visitantes.service.ts` ~2152-2173 (criação de
visita) acha a `Pessoa` pelo CPF e a anexa; `mapVisitaParaRespostaLegada`
(~2394-2431) devolve `foto_documento`, `foto_pessoa` e `face_id` dela. Um
morador da unidade A cria visita com o CPF de um visitante da unidade B e
recebe nome real, foto do rosto, foto do documento e `face_id`.
Também: `prestadores/prestadores.service.ts` `GET get-all` (~207-225) devolve
o objeto Prisma inteiro (`foto_documento`, `face_*`) ao morador.

Fazer:
1. Respostas destinadas a quem NÃO é operador (morador no app): nunca incluir
   `foto_documento`, `face_id`, `face_sync_status`, `face_enrolled_at` nem
   outros campos `face_*`. Aplicar em `mapVisitaParaRespostaLegada` (quando o
   chamador não é operador) e em `prestadores get-all` para morador.
2. Na criação de visita por morador, se a `Pessoa` encontrada pelo CPF tem
   visita/cadastro fora das unidades de quem chama, a resposta devolve os
   dados DIGITADOS pelo chamador (nome, documento) e a foto enviada por ele, não
   os da Pessoa existente. O vínculo interno pode continuar (não muda o fluxo
   da portaria). Operador continua vendo tudo.
Testes: morador A com CPF de visitante de B → resposta sem foto_documento,
face_*, e com o nome digitado; operador → vê; prestadores get-all para
morador sem campos sensíveis.

## Task 4 — Custo do chat de IA sem teto

Achado (VERIFICADO): `chat-ia/chat-ia.service.ts` `montarPartesMensagem`
(~107-127) aceita `arquivo` sem validar tipo/tamanho/páginas; o laço de
ferramentas reenvia o anexo em até 5 rodadas (~307-329); não há cota por
usuário/condomínio/dia — só 12/min por IP e 8 chamadas simultâneas por
instância. Qualquer pessoa cria conta de síndico pelo signup público, cria
condomínio e usa o chat. A leitura de etiqueta de encomenda
(`encomendas/encomendas.controller.ts` ~31) também chama a IA paga.

Fazer:
1. Validar `arquivo` no servidor: apenas pdf, jpeg, png, webp (pelos bytes
   iniciais, não só pelo nome/mime informado), até 5 MB decodificado; fora
   disso → 400 "Arquivo não aceito: envie PDF ou imagem de até 5 MB."
2. O anexo vai só na primeira rodada do laço de ferramentas; nas seguintes,
   substituir por um texto curto ("[anexo enviado na primeira mensagem]").
3. Cota diária via `EstadoCompartilhado` (chave com a data em -03:00):
   por usuário 60 perguntas/dia, por condomínio 300/dia; leitura de etiqueta
   200/dia por condomínio. Valores em constantes nomeadas, sobrescrevíveis
   por env (`CHAT_IA_COTA_USUARIO_DIA`, `CHAT_IA_COTA_CONDOMINIO_DIA`,
   `ETIQUETA_IA_COTA_CONDOMINIO_DIA`). Estourou → 429 "Limite diário do
   assistente atingido. Tente novamente amanhã." Pergunta que falha antes de
   chamar o modelo não consome cota.
Testes: anexo com bytes de HTML/EXE renomeado → 400; 6 MB → 400; anexo só na
1ª rodada; cota de usuário e de condomínio; erro antes do modelo não consome.

## Task 5 — Categorias de ocorrência globais editáveis por qualquer síndico

Achado (VERIFICADO): `Ocorrencias_Categorias` não tem `id_condominio`
(`prisma/schema.prisma` ~57-66); `ocorrencias/ocorrencias.service.ts` ~96-130
permite criar/renomear/apagar com `assertStaff`; rotas no app
(`auth/mobile-auth.controller.ts` ~583-610). Um síndico criado pelo signup
público altera nome e SLA das ocorrências de todos os prédios. `removeCategoria`
não é aguardado no controller (~608).

Ruling do controlador: sem coluna nova, as categorias passam a ser só leitura
para síndico/funcionário/morador; escrita só por administrador do CRM
(`CrmAdminGuard`), por rotas do CRM. As rotas de escrita do app e do console
respondem 403 "As categorias são definidas pela Prestare." Leitura inalterada.

Fazer: o descrito no ruling; `await` no remove; rotas de escrita no módulo do
CRM (criar/atualizar/remover) protegidas pelo guard existente.
Testes: síndico tenta criar/atualizar/remover pelo app e pelo console → 403;
admin do CRM → ok; listagem inalterada.

## Task 6 — Condomínio desativado não derruba o app

Achado (VERIFICADO): `auth/tenant-access.service.ts` `assertCondominio`
(~44-133), `loginMorador` (`auth/mobile-auth.service.ts` ~649-674) e
`loginSindico` (~167-219) não olham `condominio.ativo`; a web já corta
(`auth/auth.service.ts` ~293, ~561, ~587). Com o condomínio desligado pelo
CRM, moradores, síndico e funcionários seguem lendo e gravando pelo app.

Fazer: incluir `condominio: { ativo: 1 }` (ou equivalente do schema) nas
consultas de vínculo de `assertCondominio`; nos logins do app, não oferecer
condomínio inativo e, se o usuário só tiver vínculos inativos, recusar com
"O acesso deste condomínio está suspenso. Fale com a administração."
(mesma frase da web, se existir — reutilize).
Testes: vínculo em condomínio inativo → 403 em rota com `:idCondominio` e em
rota do app que usa `assertCondominio`; login só com vínculo inativo → recusa;
com um ativo e um inativo → só o ativo listado.

## Task 7 — Enumeração de contas e oráculos de CPF

Achado (VERIFICADO): `solicitarCodigoRedefinicao`
(`auth/mobile-auth.service.ts` ~2710-2716 e ~2809-2815) responde diferente
quando a conta existe; `signupSindico` (~290-296, público) diz "Este CPF já
está cadastrado no sistema."; `saveMorador` (criação, ~3978-3982) diz "CPF …
com outro e-mail".

Fazer: resposta idêntica nos dois ramos de `solicitarCodigoRedefinicao`
(texto e status); no signup, quando o CPF ou o e-mail já existem, mensagem
genérica "Não foi possível concluir o cadastro com esses dados. Se você já tem
conta, entre ou recupere a senha."; em `saveMorador`, a mensagem não pode
revelar a associação CPF↔e-mail de outra conta ("Já existe uma conta com
este CPF. Use o e-mail da conta existente ou fale com o suporte.").
Testes: as três mensagens; conta existente e inexistente produzem a mesma
resposta.

## Task 8 — Link assinado renovável e chave de arquivo arbitrária

Achado (VERIFICADO): `common/interceptors/arquivos-privados.interceptor.ts`
(~39, ~49) assina qualquer URL do bucket em qualquer resposta e remove a
assinatura na entrada; `common/storage/storage.service.ts` `assinarUrl`
(~229-245) não confere dono; `normalizarFoto` (`auth/mobile-auth.service.ts`
~238, usada em `updateSindico` ~441) aceita URL arbitrária; `documentos`
`insert` com `link_doc` (`documentos/documentos.service.ts` ~25) também — e o
indexador do chat baixa o arquivo para o índice do condomínio de quem pediu.
Quem guardou uma URL (ex-porteiro) obtém link novo para sempre.

Fazer: campos de arquivo recebidos do cliente só aceitam (a) data URL nova,
que vira upload, (b) a MESMA chave já gravada naquela entidade, ou (c) vazio.
Qualquer outra URL do bucket → 400 "Arquivo inválido." Aplicar em
`normalizarFoto` (e todos os chamadores) e em `link_doc`. URL externa (fora do
bucket) segue a regra atual de cada campo.
Testes: chave de outro registro → 400; mesma chave → aceita; data URL →
upload; vazio → limpa.

## Task 9 — Autorizações finas do app (lote)

Achados (VERIFICADOS):
- Flags do funcionário ignoradas no app: `listOcorrenciasTodos`/
  `listOcorrenciasPendentes` (~4502-4546) e `listMessages` via `ehEquipe`
  (`ocorrencias/ocorrencias.service.ts` ~59-74) entregam ocorrência privada a
  funcionário com `ocorrencias=0` (o `getOcorrenciaById` cobra); `saveApto`
  (~4346-4392), `saveMorador`/`removeMorador` (~3891, ~4188) não cobram a flag
  `apartamentos` (o `ApartamentosService` do console cobra).
- `/vagas/liberar` (~5420-5442): `id_veiculo` sem conferência; beneficiário
  só conferido contra o condomínio. Exigir veículo de morador do mesmo
  apartamento do chamador e beneficiário morador do mesmo apartamento.
- Votação (`assembleias/assembleias.service.ts` ~345-380): um voto por conta;
  equipe sem unidade vota. Exigir vínculo em `Apartamentos_Users` do
  condomínio e um voto por apartamento (o voto novo de outra conta do mesmo
  apartamento substitui o anterior, como já faz por usuário).
- Financeiro (`financeiro/financeiro.controller.ts` ~215-221,
  `financeiro.service.ts` ~806-811): síndico lê contas pessoais (tipo 'D' com
  `id_usuario`) de moradores; conta pessoal só para o dono.
- `POST /users/delete-account` (~1958-1967): `deleteMany` em
  `Funcionarios_Portaria` por login/e-mail sem condomínio; apagar só os
  porteiros ligados à pessoa pelos vínculos dela.
- Mudança aprovada remarcada pelo morador (`mudancas/mudancas.service.ts`
  ~97-130) continua aprovada: volta a `pendente` quando data/hora/unidade
  mudam por quem não é da equipe.
- `GET /funcionarios/get-all` (~3170-3202) sem `assertOperador`: morador lê
  e-mail e telefone da equipe.
- CSV do CRM (`crm/crm.service.ts` ~319-322) sem `csvCelula` (injeção de
  fórmula).
Fazer cada item com teste próprio.
