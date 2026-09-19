# Ajustes de Permissões e Telas do Porteiro (Financeiro, Visitantes e Eventos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajustar o aplicativo e a API para o perfil Porteiro (Funcionário): exibir exclusivamente o financeiro do condomínio (receitas/despesas), permitir cadastrar visitas e prestadores de serviço com registro de entrada/saída (sem permitir edição de cadastros existentes feitos por moradores), e exibir os eventos e acessos do condomínio.

**Architecture:** 
- Backend: Em `DB_Acessos.js` e `ControllerDashboard.js`, ajustar `getMeusEventos` para quando o usuário autenticado for `Funcionario`: buscar o `id_condominio` do funcionário e retornar os acessos faciais e entradas/saídas de todo o condomínio nos últimos 30 dias.
- Mobile Financeiro: Em `list_financeiro.dart`, travar `_viewMode` em `FinanceiroViewMode.condominio` para `funcionario`, ocultar o toggle "MEU FINANCEIRO", e evitar a chamada desnecessária a `apiGetFinanceiroByUser()`.
- Mobile Visitantes: Em `list_visitantes.dart`, ocultar o botão "Editar" nos detalhes do visitante quando for `funcionario`, mantendo os botões de registro de Entrada e Saída; e em `my_condominium.dart`, na aba Visitantes, possibilitar o cadastro tanto de Visitantes quanto de Prestadores de Serviço via modal seletor rápido.
- Mobile Eventos: Em `list_condominiums.dart`, alterar o rótulo de "Meus eventos" para "Eventos do condomínio" para `funcionario`.

**Tech Stack:** Node.js, Express, MySQL, Flutter / Dart.

**Spec:** Conversa de alinhamento com o usuário aprovada em 19/09/2026.

## Global Constraints

- Never execute destructive operations against production database.
- TDD required: tests must be written or updated to verify each behavior.
- All Flutter tests must pass: `flutter test`.
- All API tests must pass: `npm test`.
- Visual styling must adhere to the existing Prestare UI design tokens (PhosphorIcons, AppColors, AppTypography, AppSpacing).

---

### Task 1: Backend - Eventos do condomínio para Perfil Funcionário

**Files:**
- Modify: `click-cond-api/click-cond-api/src/database/DB_Acessos.js:120-188`
- Modify: `click-cond-api/click-cond-api/src/controller/ControllerDashboard.js:74-82`
- Test: `click-cond-api/click-cond-api/test/acessos_funcionario_eventos.test.js`

**Interfaces:**
- Consumes: `req.session.user` contendo `{ id, typeAccess }`.
- Produces: `getMeusEventos(idUser, limit, typeAccess)` retornando lista de eventos de acesso do condomínio para funcionários, ou dos apartamentos/visitantes do morador para moradores.

- [ ] **Step 1: Write the failing unit test**

Create `click-cond-api/click-cond-api/test/acessos_funcionario_eventos.test.js`:
```javascript
const dbAcessos = require('../src/database/DB_Acessos');
const db = require('../src/database/MySQL');

describe('DB_Acessos.getMeusEventos para Funcionario', () => {
  it('deve retornar eventos do condominio do funcionario quando typeAccess for Funcionario', async () => {
    const originalQueryParam = db.queryParam;
    try {
      db.queryParam = jest.fn().mockImplementation((query, params) => {
        if (query.includes('from Funcionarios where id_user = ?')) {
          return Promise.resolve({ results: [{ id_condominio: 2 }] });
        }
        if (query.includes('from Acessos_Facial af')) {
          return Promise.resolve({
            results: [
              {
                id: 101,
                id_pessoa: 50,
                nome_pessoa: 'Visitante Teste',
                evento: 'entrada',
                timestamp: new Date().toISOString(),
                tipo_pessoa: 'visitante',
                tipo_dispositivo: 'catraca',
                confianca: 95,
                condominio: 'Condominio Teste'
              }
            ]
          });
        }
        return Promise.resolve({ results: [] });
      });

      const eventos = await dbAcessos.getMeusEventos(99, 10, 'Funcionario');
      expect(Array.isArray(eventos)).toBe(true);
      expect(eventos.length).toBe(1);
      expect(eventos[0].nome).toBe('Visitante Teste');
      expect(eventos[0].categoria).toBe('visitante');
    } finally {
      db.queryParam = originalQueryParam;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/acessos_funcionario_eventos.test.js` (no diretório `click-cond-api/click-cond-api`)
Expected: FAIL (pois `getMeusEventos` ainda busca moradores/apartamentos_users para uid 99 e não trata `typeAccess == 'Funcionario'`).

- [ ] **Step 3: Implement minimal code to pass the test**

Em `DB_Acessos.js`:
```javascript
  getMeusEventos: async function (idUser, limit, typeAccess) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 50);
    const uid = parseInt(idUser, 10);
    if (!uid) return [];

    const selectBase = `select af.id, af.id_pessoa, af.nome_pessoa, af.evento, af.timestamp, af.tipo_pessoa,
                               af.tipo_dispositivo, af.confianca, c.nome as condominio
                          from Acessos_Facial af
                          left join Condominios c on c.id = af.id_condominio`;

    // Se for funcionário/porteiro, busca eventos de todo o condomínio onde trabalha
    if (typeAccess === 'Funcionario') {
      const { results: func } = await db.queryParam(
        'select id_condominio from Funcionarios where id_user = ? limit 1', [uid]);
      const idCond = func && func[0] ? func[0].id_condominio : null;
      if (!idCond) return [];

      const { results } = await db.queryParam(
        `${selectBase}
          where af.id_condominio = ?
            and af.evento in ('entrada','saida')
            and af.timestamp >= date_sub(now(), interval 30 day)
          order by af.timestamp desc limit ?`, [idCond, lim]);

      return (results || []).map((e) => ({
        id: e.id,
        id_pessoa: e.id_pessoa,
        nome: (e.nome_pessoa || '').replace(/\s*\([^)]*\)\s*$/, '').trim(),
        evento: e.evento,
        tipo_pessoa: e.tipo_pessoa,
        tipo_dispositivo: e.tipo_dispositivo,
        confianca: e.confianca,
        categoria: e.tipo_pessoa === 'morador' ? 'voce' : (e.tipo_pessoa === 'prestador' ? 'prestador' : 'visitante'),
        condominio: e.condominio || '',
        timestamp: e.timestamp,
      }));
    }

    // Fluxo normal para moradores...
    ...
```

E em `ControllerDashboard.js`:
```javascript
  async getMeusEventos(req, res) {
    try {
      const eventos = await dbAcessos.getMeusEventos(
        req.session.user.id,
        req.query.limit,
        req.session.user.typeAccess
      );
      return res.status(200).json(eventos);
    } catch (err) {
      console.error('[getMeusEventos Error]', err);
      return res.status(500).json({ message: err.message });
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/acessos_funcionario_eventos.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add click-cond-api/click-cond-api/src/database/DB_Acessos.js click-cond-api/click-cond-api/src/controller/ControllerDashboard.js click-cond-api/click-cond-api/test/acessos_funcionario_eventos.test.js
git commit -m "fix(api): support condominium-wide events in getMeusEventos for funcionario"
```

---

### Task 2: Mobile - Financeiro Exclusivo do Condomínio para Porteiro

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/financeiro/list_financeiro.dart`
- Test: `click-cond-app/click-cond-app/test/porteiro_financeiro_view_test.dart`

**Interfaces:**
- Consumes: `getUserType()` retornando `'funcionario'`, `'sindico'` ou `'morador'`.
- Produces: `_viewMode` forçado em `FinanceiroViewMode.condominio` para funcionários, com toggle oculto e sem requisição a dados pessoais.

- [ ] **Step 1: Write the failing test**

Create `click-cond-app/click-cond-app/test/porteiro_financeiro_view_test.dart`:
Verificar que quando `getUserType()` é `funcionario`:
- O modo inicial de visualização é `FinanceiroViewMode.condominio`.
- O toggle "MEU FINANCEIRO" não é renderizado.
- O botão de exportar relatório pessoal no AppBar não é renderizado.

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/porteiro_financeiro_view_test.dart` (no diretório `click-cond-app/click-cond-app`)
Expected: FAIL.

- [ ] **Step 3: Implement changes in list_financeiro.dart**

1. Em `initState()`:
```dart
final isFunc = getUserType() == 'funcionario';
_viewMode = (getUserType() == 'morador')
    ? FinanceiroViewMode.morador
    : FinanceiroViewMode.condominio;
```
2. Em `loadList()`:
```dart
if (getUserType() != 'funcionario') {
  if (!isMonthChange || _personalLancamentos.isEmpty) {
    final dynamic personalData = await apiGetFinanceiroByUser();
    if (personalData is List) {
      _personalLancamentos = personalData;
    } else {
      _personalLancamentos = [];
    }
  }
} else {
  _personalLancamentos = [];
}
```
3. Em `_buildViewToggle()`:
Se `getUserType() == 'funcionario'`, retornar `const SizedBox.shrink();`.
4. Em `actions` do Scaffold (linha ~252):
Ocultar o botão de download de relatório pessoal se `getUserType() == 'funcionario'` ou `isSindico`.

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/porteiro_financeiro_view_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add click-cond-app/click-cond-app/lib/pages/shared/financeiro/list_financeiro.dart click-cond-app/click-cond-app/test/porteiro_financeiro_view_test.dart
git commit -m "fix(app): lock porteiro financeiro to condominium view and hide personal toggle"
```

---

### Task 3: Mobile - Permissões de Visitantes e Prestadores para Porteiro

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/visitantes/list_visitantes.dart:731-760`
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/my_condominium.dart:700-725`
- Test: `click-cond-app/click-cond-app/test/porteiro_visitantes_permissions_test.dart`

**Interfaces:**
- Consumes: `_showVisitanteDetails` e ação de "Cadastrar" da aba Visitantes.
- Produces: Porteiro registra entradas/saídas mas não pode editar registros existentes de visitantes. Porteiro pode cadastrar Visitantes e Prestadores através de um modal seletor limpo na barra de navegação inferior.

- [ ] **Step 1: Write the failing test**

Create `click-cond-app/click-cond-app/test/porteiro_visitantes_permissions_test.dart`:
Verificar que para `funcionario`:
- No modal de detalhes do visitante, o botão "Editar" (`ElevatedButton.icon` com label 'Editar') NÃO é exibido.
- Os botões de ação de entrada/saída permanecem disponíveis para visitantes autorizados.

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/porteiro_visitantes_permissions_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement changes**

1. Em `list_visitantes.dart`:
Na exibição do botão secundário de edição:
```dart
final canEdit = (getUserType() != 'funcionario') && canAdd;
if (canEdit) ...[
  const SizedBox(width: 12),
  Expanded(
    child: ElevatedButton.icon(
      onPressed: () { ... },
      icon: const Icon(PhosphorIcons.pencilSimple, ...),
      label: const Text('Editar', ...),
    ),
  ),
],
```
2. Em `my_condominium.dart`:
No botão de ação da aba Visitantes (`showVisitantesAction`):
```dart
onTap: () {
  if (isFuncionario || isSindico) {
    _showCadastrarVisitanteOuPrestadorSheet(context);
  } else {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const NewVisitante(isEdit: false)),
    ).then((_) {
      _visitantesKey.currentState?.loadList();
    });
  }
}
```
Implementar `_showCadastrarVisitanteOuPrestadorSheet(BuildContext context)` com opções elegantes:
- "Cadastrar Visitante" -> abre `NewVisitante(isEdit: false)`
- "Cadastrar Prestador" -> abre `NewPrestador(isEdit: false)`

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/porteiro_visitantes_permissions_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add click-cond-app/click-cond-app/lib/pages/shared/visitantes/list_visitantes.dart click-cond-app/click-cond-app/lib/pages/shared/my_condominium.dart click-cond-app/click-cond-app/test/porteiro_visitantes_permissions_test.dart
git commit -m "fix(app): restrict porteiro from editing visitor records and enable both visit and provider creation"
```

---

### Task 4: Mobile - Visualização de Eventos do Condomínio para Porteiro

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/sindico/list_condominiums.dart:1300-1315`
- Test: `click-cond-app/click-cond-app/test/porteiro_eventos_title_test.dart`

**Interfaces:**
- Consumes: `getUserType()`.
- Produces: Rótulo "Eventos do condomínio" para funcionário na Home.

- [ ] **Step 1: Write the failing test**

Create `click-cond-app/click-cond-app/test/porteiro_eventos_title_test.dart`:
Verificar que para `getUserType() == 'funcionario'`, o cabeçalho exibe "Eventos do condomínio" em vez de "Meus eventos".

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/porteiro_eventos_title_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement changes in list_condominiums.dart**

```dart
Text(
  getUserType() == 'funcionario' ? 'Eventos do condomínio' : 'Meus eventos',
  style: TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w800,
    color: isDark ? Colors.white : const Color(0xFF0F172A),
    letterSpacing: -0.2,
  ),
),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/porteiro_eventos_title_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add click-cond-app/click-cond-app/lib/pages/sindico/list_condominiums.dart click-cond-app/click-cond-app/test/porteiro_eventos_title_test.dart
git commit -m "feat(app): display 'Eventos do condomínio' on home feed for funcionario"
```

---

### Task 5: Regressão e Verificação Geral

- [ ] **Step 1: Executar suite completa do backend**
Run: `npm test` em `click-cond-api/click-cond-api`
Expected: 100% testes passando.

- [ ] **Step 2: Executar suite completa do mobile**
Run: `flutter test` em `click-cond-app/click-cond-app`
Expected: Todos os testes passando sem quebras.
