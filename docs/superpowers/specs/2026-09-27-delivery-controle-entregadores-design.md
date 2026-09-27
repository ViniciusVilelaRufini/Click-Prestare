# Delivery — controle de entregadores

## Objetivo

Criar uma área de Delivery para controlar o acesso de entregadores ao condomínio. O morador avisa uma entrega pelo app; a portaria recebe e conduz o atendimento pelo portal web; o sistema mantém um histórico auditável. Não há catálogo de parceiros, pedidos comerciais ou pagamentos.

## Escopo aprovado

- O morador cria, acompanha e cancela o aviso de entrega no app.
- A portaria acompanha a fila, registra a chegada, associa ou cadastra o entregador e finaliza o atendimento no web.
- Entregadores (motoboys) têm cadastro reutilizável por condomínio, incluindo veículo e bloqueio.
- Eventos de cada atendimento preservam autor, data/hora, status, observação e motivo quando aplicável.
- O módulo oferece filtros operacionais e relatório básico de atendimentos.

## Fora de escopo

- Vitrine de estabelecimentos, cardápio, carrinho, pagamento e repasse financeiro.
- Acesso dos moradores a documentos, bloqueios ou histórico de outros entregadores.
- Biometria/facial como requisito do primeiro lançamento.

## Perfis e permissões

| Perfil | Ações |
| --- | --- |
| Morador | Criar aviso para sua unidade, acompanhar e cancelar antes da chegada; ver somente seus avisos. |
| Portaria/funcionário | Ver fila do condomínio, registrar chegada, associar/cadastrar entregador, atualizar estados e registrar observações. |
| Síndico/admin | Todas as ações da portaria, gerir cadastros e bloqueios de entregadores e visualizar relatórios. |

As consultas e mutações sempre serão limitadas ao condomínio ativo. O vínculo da unidade do morador será validado no servidor.

## Modelo de dados

### Entregador

Cadastro reutilizável por condomínio: `id`, `id_condominio`, nome, telefone, documento opcional, plataforma/empresa opcional, status (`ATIVO`, `BLOQUEADO`), motivo do bloqueio, foto opcional, criado/em e atualizado/em.

### Veículo do entregador

Vinculado ao entregador: tipo, placa, modelo e cor. A placa é normalizada e única por condomínio quando informada.

### Atendimento de delivery

Vincula condomínio, unidade, morador solicitante, entregador opcional e dados de chegada. Campos principais: estabelecimento informado pelo morador, previsão, observação do morador, status atual, modo de entrega (`UNIDADE` ou `PORTARIA`), criado/em, chegou/em, autorizado/em, concluído/em, cancelado/em, recusado/em e motivo da ocorrência.

### Evento de delivery

Registro imutável de transição de status, incluindo status anterior/novo, autor autenticado, mensagem opcional e data/hora. O histórico de auditoria jamais é apagado com o atendimento.

## Fluxo de status

1. `AGENDADA`: morador avisou a entrega, ainda sem chegada.
2. `CHEGOU`: portaria confirmou a presença do entregador.
3. `AGUARDANDO_AUTORIZACAO`: a portaria solicitou confirmação do morador, quando aplicável.
4. `AUTORIZADA`: entrega liberada para a unidade.
5. `RETIRADA_NA_PORTARIA`: morador retirará ou recebeu na portaria.
6. `CONCLUIDA`: entrega finalizada e entregador liberado.

Estados terminais: `CANCELADA` e `RECUSADA`. Toda transição inválida é rejeitada pela API; `RECUSADA`, `CANCELADA` e bloqueio exigem motivo.

## Experiência no aplicativo

Uma entrada “Delivery” mostrará avisos ativos e histórico. O formulário de novo aviso pede unidade (preenchida quando houver uma única), estabelecimento opcional, nome/telefone do entregador opcionais, previsão e observação. A tela de detalhes exibe a linha do tempo, estado atual e o tipo de entrega. O morador é notificado ao chegar, quando houver pedido de autorização e ao concluir.

## Experiência no portal web

A navegação adicionará “Delivery” próximo de Encomendas. A tela principal começa pela fila ativa, com contadores por estado, busca por unidade, nome, telefone e placa e filtros de status. Cada atendimento oferece as ações permitidas pelo estado e abre um painel de detalhes/histórico.

A aba “Entregadores” lista e pesquisa cadastros. O atendente pode selecionar um entregador existente durante a chegada ou criá-lo sem perder o atendimento. Cadastros bloqueados são destacados e não podem ser autorizados; o histórico permanece visível para administradores.

## API e integração

O backend Nest/Prisma terá um módulo `delivery` separado do módulo de encomendas, com recursos para atendimentos, entregadores e eventos. Endpoints protegidos aplicarão o padrão existente de autenticação, condomínio ativo e permissões. A criação e cada mudança de estado gerarão eventos de auditoria e notificações para o morador quando pertinentes.

## Erros e regras

- Morador não pode criar ou acessar aviso de unidade que não lhe pertence.
- Entregador bloqueado não pode ser associado a uma transição de autorização.
- Dados de entregador podem ser incompletos no primeiro atendimento, mas o nome é obrigatório para criar cadastro.
- Falhas de rede no app e no web mostram feedback recuperável e não alteram o estado local sem confirmação do servidor.
- Identificadores e documentos não são expostos em listagens do morador.

## Testes e aceite

- API: regras de escopo, transições válidas/inválidas, bloqueio, criação/consulta de entregador e geração de eventos.
- Web: rota protegida, inclusão no menu, fila, filtro e bloqueio de autorização.
- App: criação de aviso, visualização de status e cancelamento enquanto agendado.
- E2E web: login, acesso à área Delivery, cadastro de motoboy e registro de atendimento usando o ambiente informado.

O módulo está aceito quando um morador consegue avisar uma entrega, a portaria identifica ou cadastra o motoboy, conduz a entrega até um estado terminal e o histórico mostra o ciclo completo sem cruzar dados entre condomínios.
