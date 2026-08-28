# Nova Área de Eventos de Entrada e Saída de Visitantes e Prestadores

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma área dedicada exclusivamente para visualização, filtros e detalhes dos eventos de entrada e saída de visitantes e prestadores de serviço, removendo a abertura indesejada da tela de cadastro/edição ao tocar em eventos na tela inicial ("Meus Eventos").

**Architecture:** 
1. **Frontend Flutter (`click-cond-app`)**:
   - Criação/reformulação da tela dedicada `EventosAcessosPage` (substituindo/aprimorando `HistoricoAcessosPage`) com visual moderno, filtros rápidos por categoria (Todos, Visitantes, Prestadores, Entradas, Saídas), campo de busca por nome e modal detalhado de evento (bottom sheet com data/hora, condomínio, método de acesso facial/QR/Tag, etc.).
   - Atualização do componente "MEUS EVENTOS" na Home (`list_condominiums.dart`) adicionando botão "Ver todos" no cabeçalho e alterando o clique nos itens de evento para abrir a nova área/detalhes do evento, em vez de abrir a tela de edição de cadastro (`NewVisitante`).
   - Adição do atalho "Eventos de Acesso" no menu do condomínio (`my_condominium.dart`).
2. **Backend API (`click-cond-web` & `click-cond-api`)**:
   - Garantir que o endpoint `GET /dashboard/meus-eventos` devolva metadados ricos dos acessos (`tipo_dispositivo`, `confianca`, `id_condominio`, `condominio`, `timestamp`, etc.).

**Tech Stack:** Flutter (Dart), NestJS / Node.js (Prisma / MySQL), Phosphor Icons, App Design System (Design Tokens).

---

## Global Constraints

- Manter compatibilidade com os endpoints existentes (`/dashboard/meus-eventos`).
- Não quebrar integrações existentes de notificações push que abrem `HistoricoAcessosPage(destacarId: id)`.
- Seguir o design system e paleta de cores (AppColors, AppTypography, AppSpacing, PhosphorIcons).

---

### Task 1: Backend - Enriquecer retorno de `getMeusEventos`

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:1100-1120`
- Modify: `click-cond-api/click-cond-api/src/database/DB_Acessos.js:145-185`

- [ ] **Step 1: Incluir campos no backend NestJS (`mobile-auth.service.ts`)**
Adicionar `tipo_dispositivo` e `confianca` no objeto mapeado retornado por `getMeusEventos`.

- [ ] **Step 2: Incluir campos no backend legado Node (`DB_Acessos.js`)**
Adicionar `tipo_dispositivo` e `confianca` na query SQL de `DB_Acessos.getMeusEventos`.

---

### Task 2: Flutter - Nova tela `HistoricoAcessosPage` (Eventos de Acesso) com Filtros e Modal de Detalhes

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/notificacoes/historico_acessos_page.dart`

- [ ] **Step 1: Implementar filtros por categoria e busca por nome**
Criar filtro com chips ("Todos", "Visitantes", "Prestadores", "Entradas", "Saídas") e campo de busca por nome em tempo real.

- [ ] **Step 2: Implementar modal BottomSheet de Detalhes do Acesso**
Criar `_showDetalhesEvento(BuildContext context, dynamic evento)` que exibe:
  - Cabeçalho com ícone e badge de Entrada / Saída
  - Nome completo da pessoa e categoria (Visitante / Prestador)
  - Data e hora exata da passagem
  - Nome do condomínio
  - Método de acesso identificado (Reconhecimento Facial, Tag RFID, QR Code, Catraca, Botoeira, Manual)
  - Nível de confiança biométrica (quando disponível)

- [ ] **Step 3: Ajustar clique nos cards de evento**
Alterar o `onTap` dos cards de evento para chamar `_showDetalhesEvento(...)` em vez de chamar `_abrirCadastroVisitante(...)`.

---

### Task 3: Flutter - Atualizar Meus Eventos na Home (`list_condominiums.dart`)

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/sindico/list_condominiums.dart:1210-1375`

- [ ] **Step 1: Adicionar botão "Ver todos" no cabeçalho "MEUS EVENTOS"**
Ao tocar em "Ver todos", navegar para `HistoricoAcessosPage()`.

- [ ] **Step 2: Atualizar clique nos eventos de "MEUS EVENTOS" na Home**
Substituir a navegação para `NewVisitante` por navegação direta para `HistoricoAcessosPage(destacarId: id)` e/ou exibição dos detalhes do evento.

---

### Task 4: Flutter - Adicionar Atalho no Menu do Condomínio (`my_condominium.dart`)

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/my_condominium.dart:135-175`

- [ ] **Step 1: Adicionar item "Eventos de Acesso" no menu do condomínio**
Incluir `_MenuItem('Eventos de Acesso', PhosphorIcons.clockCounterClockwise, const HistoricoAcessosPage())` no menu para moradores, funcionários e síndicos.

---

### Task 5: Validação e Testes

- [ ] **Step 1: Executar `flutter analyze`**
- [ ] **Step 2: Executar `flutter test`**
- [ ] **Step 3: Validar a navegação e experiência visual**
