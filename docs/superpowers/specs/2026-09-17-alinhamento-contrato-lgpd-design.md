# Alinhamento do Sistema ao Contrato Prestare Gestão e DPA (LGPD) — Design

Design técnico para adequar o sistema Prestare Gestão às obrigações assumidas no Contrato de Licença de Uso de Software e no Acordo de Tratamento de Dados Pessoais (DPA).

Status: Validado e Aprovado.
Data: 2026-09-17.
Repositório: `c:\Users\vinic\Desktop\Click-with-Prestare`

---

## 1. Contexto e Problema

A análise jurídica do Contrato de Licença de Uso de Software e do DPA (Anexo II) identificou 4 pontos críticos em que o texto contratual prometia mais do que o sistema executava:

1. **Exportação de Dados (Cláusula 9.5 e DPA 11.2):** O contrato estabelece que o CONTRATANTE poderá solicitar a exportação dos dados disponíveis em formato usual. Não existia endpoint no backend nem tela para exportação consolidada do condomínio, restringindo-se a dumps manuais.
2. **Revogação do Consentimento Biométrico (Cláusula 8.4 e DPA 9.3):** O consentimento de biometria era consultado apenas no enrolamento. Se o morador revogasse depois, não havia mecanismo de desprovisionamento do rosto nos terminais faciais, nem tela no app para o titular revogar, deixando o hardware com acesso liberado.
3. **Biometria de Visitantes e Prestadores (Cláusulas 8.1, 8.3 e DPA 9.1):** O contrato proíbe biometria sem consentimento prévio e destacado obtido pelo condomínio, bem como biometria de menores. As rotas de sincronização de terceiros enrolavam fotos na portaria sem nenhuma declaração ou checagem formal.
4. **Idade Mínima de 18 Anos (Cláusula 8.3 e Anexo I):** O contrato veda terminantemente menores de 18 anos como usuários do software ou titulares de perfis biométricos. Não havia validação de data de nascimento no backend barrando contas ou fotos de menores.

---

## 2. Decisões Arquiteturais

| Decisão | Escolha | Motivo |
|---|---|---|
| Formato de Exportação | **Arquivo `.zip` com múltiplos `.csv` (UTF-8 com BOM)** | Formato aberto, universal e compatível com Excel e bancos de dados, sem travar a memória do servidor |
| Acesso à Exportação | **Exclusivo para Síndico no painel web (`assertSindico`)** | Sigilo financeiro, segregação de funções e conformidade com a LGPD |
| Revogação Biometria (Morador) | **No App Móvel (Configurações > Privacidade) e no Painel Web pelo Síndico** | Garante o direito direto do titular (Art. 18 LGPD) e a gestão pelo condomínio (Cláusula 8.4) |
| Remoção em Hardware | **Imediata via `FacialService.unsyncMorador()` com estado `pending_removal` se offline** | Impede o titular revogado de continuar abrindo a portaria, com reconciliação no reconnect |
| Terceiros (Visitantes/Prestadores) | **Checkbox de consentimento/maioridade na modal de foto da portaria web + tabela `Consentimentos_Terceiros`** | Sem declaração válida, a foto fica apenas para visualização em tela, nunca indo para os terminais |
| Validação de Menoridade | **`data_nascimento` obrigatória para criar login (`Users`) ou cadastrar biometria facial; bloqueio rígido se < 18** | Permite cadastro de menores apenas como dependentes sem login e sem biometria |

---

## 3. Especificação dos Componentes

### 3.1 Módulo de Exportação de Dados do Condomínio

#### Backend (`CondominiosExportService`)
- Localização: `apps/api/src/app/relatorios/condominios-export.service.ts`
- Controller: `apps/api/src/app/relatorios/relatorios.controller.ts`
- Rota: `GET /condominios/:idCondominio/export`
- Regra de Acesso: `assertSindico(payload)`
- Conteúdo do `.zip`:
  - `unidades_e_moradores.csv`: Bloco, Unidade, Nome, Tipo (Proprietário/Inquilino), E-mail, Telefone, Documento, Data de Nascimento.
  - `veiculos_e_vagas.csv`: Placa, Modelo, Cor, Bloco/Unidade, Vaga.
  - `visitantes_e_prestadores.csv`: Nome, Documento, Tipo, Unidade de Destino, Data/Hora Entrada, Data/Hora Saída, Situação.
  - `encomendas.csv`: Código/Rastreio, Destinatário, Data de Chegada, Data de Retirada, Quem Retirou.
  - `ocorrencias.csv`: Título, Categoria, Data de Abertura, Unidade, Status, Descrição.
  - `registros_acessos.csv`: Histórico de passagens nas catracas/portarias (Data/Hora, Pessoa, Ponto de Acesso, Tipo de Validação).
- Auditoria: Registra no `AuditLog` (`acao: 'EXPORT'`, `modulo: 'condominios'`).

#### Frontend (`portaria-web`)
- Na tela de Relatórios / Configurações do Síndico: Card "Exportação Completa de Dados (LGPD)" com botão "Baixar Exportação (.zip)".

---

### 3.2 Ciclo de Vida e Revogação do Consentimento Biométrico

#### Backend (`ConsentimentosService` + `FacialService`)
- Endpoints:
  - `POST /consentimentos/revogar-biometria`: Morador logado no app móvel revoga sua própria biometria.
  - `POST /condominios/:idCondominio/moradores/:idMorador/revogar-biometria`: Síndico/Portaria revoga a pedido formal do titular.
- Fluxo de Execução:
  1. `ConsentimentosService.registrar(idUser, { privacidade: true, biometria: false })` grava novo registro append-only com `aceito = 0`.
  2. Localiza os registros de `moradores` associados ao titular.
  3. Para cada morador com `face_id`: invoca `facialService.unsyncMorador(morador.id, morador.face_id, morador.id_condominio)`.
  4. Se todos os dispositivos responderem com sucesso: atualiza `moradores` com `face_id = null`, `face_sync_status = 'revoked'`, `face_sync_error = null`.
  5. Se algum terminal falhar (offline): marca `face_sync_status = 'pending_removal'`, `face_sync_error = 'device_offline'` para re-tentativa pelo sincronizador.
  6. Registra ação no `AuditLog`.

#### Frontend Mobile (`click-cond-app`)
- Em Perfil / Configurações > Privacidade: item "Reconhecimento Facial: Ativo", com botão "Revogar Autorização Facial" e diálogo de confirmação informando desprovisionamento das catracas.

#### Frontend Web (`portaria-web`)
- Na edição do morador: badge de status biométrico e botão de ação "Revogar Biometria Facial" para atendimento a pedidos de moradores.

---

### 3.3 Gestão de Consentimento e Maioridade de Terceiros

#### Backend (`ConsentimentosTerceirosService`)
- Tabela `Consentimentos_Terceiros` (já criada no schema): append-only, indexada por `(id_condominio, doc, registrado_em)`.
- Endpoints em `ConsentimentosController`:
  - `POST /condominios/:idCondominio/consentimentos/terceiros`: grava declaração `{ tipoPessoa, idPessoa, doc, biometria, maiorIdade }`.
  - `GET /condominios/:idCondominio/consentimentos/terceiros/status`: consulta status atual do titular por documento ou id.
- Integração no `FacialService`:
  - `syncVisitante()` e `syncPrestadorServico()` barram enrolamento se `autorizouBiometria()` retornar `false`.

#### Frontend Web (`portaria-web`)
- Nos modais de cadastro/edição de Visitante e Prestador de Serviço:
  - Ao capturar ou enviar foto: exibe checkbox obrigatório:
    *"Declaro que o titular é maior de 18 anos e forneceu autorização prévia e informada para utilização de biometria facial nos acessos deste condomínio."*
  - Se desmarcado: salva a foto apenas para exibição em tela na portaria; não envia para catracas faciais.

---

### 3.4 Validação e Bloqueio de Menores de 18 Anos

#### Backend (`idade.util.ts`, `moradores.service.ts`, `mobile-auth.service.ts`)
- Utilitário: `calcularIdade(dataNascimento: Date | string): number`.
- Regra de Usuário: Se `email`, `login` ou `sendCredentials` for solicitado: `data_nascimento` é obrigatória e deve ser `>= 18`. Se `< 18`, lança `BadRequestException`.
- Regra de Biometria: Se `foto_pessoa` for informada ou `syncMorador` chamado: `data_nascimento` é obrigatória e deve ser `>= 18`. Se `< 18`, bloqueia biometria.
- Dependentes menores: Podem ser cadastrados na unidade habitacional exclusivamente com `id_user = null` (sem conta) e `foto_pessoa = null` / `face_id = null` (sem biometria).

#### Frontend Web (`portaria-web`)
- Formulário de Morador: inclusão do campo "Data de Nascimento".
- Reatividade na UI: ao selecionar data com idade < 18 anos, desabilita opções de criar login e de foto biométrica com mensagem informativa.

---

## 4. Plano de Testes Automatizados

1. **Exportação:** Testes em `condominios-export.service.spec.ts` validando geração do `.zip`, cabeçalhos UTF-8 com BOM e isolamento multi-tenant.
2. **Revogação:** Testes em `consentimentos.spec.ts` validando gravação de `aceito = 0`, chamada a `unsyncMorador` e tratamento de status `revoked` vs `pending_removal`.
3. **Terceiros:** Testes já existentes em `consentimentos-terceiros.spec.ts` complementados com testes de rota em `consentimentos.controller.spec.ts`.
4. **Menoridade:** Testes em `idade.util.spec.ts` e `moradores.service.spec.ts` validando bloqueio de conta e biometria para `< 18` e permissão para maiores e dependentes sem login.
