# Correções da varredura web + app (28/09) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os bugs levantados em `docs/testes/2026-09-28-varredura-web-app.md`, subir para produção, gerar APK novo e retestar.

**Architecture:** Correções pontuais em três pacotes do monorepo: API NestJS (`click-cond-web/apps/api`), console web Angular (`click-cond-web/apps/portaria-web`) e app Flutter (`click-cond-app/click-cond-app`). Nenhuma mudança de schema; um único ajuste de dado em produção.

**Tech Stack:** NestJS + Prisma (Jest/SWC), Angular 19 (Jest), Flutter (flutter_test).

**Spec:** `docs/testes/2026-09-28-varredura-web-app.md` (numeração dos bugs abaixo segue esse arquivo).

## Global Constraints

- Branch: `fix/varredura-2026-09-28`, criado de `origin/master`.
- Deploy: push em `master` → GitHub Actions → Elastic Beanstalk (API) e Amplify (web); empurrar também `main` (Vercel). Se os dois workflows colidirem, `gh workflow run deploy-api.yml`.
- SQL em produção roda ANTES do push e é verificado de fato (`DATABASE_URL` do `.env` é produção).
- Testes da API: `npx jest -c apps/api/jest.config.cts <spec>` a partir de `click-cond-web` (TZ=UTC já forçado na config).
- Testes do web: `npx jest -c apps/portaria-web/jest.config.ts <spec>` a partir de `click-cond-web`.
- Testes do app: `flutter test test/<arquivo>` a partir de `click-cond-app/click-cond-app`.
- Textos para o usuário em pt-BR, com acentuação.
- Fora de escopo: bug 15 (não reproduzido — contador só estava carregando). Bug 4 exige reprodução antes de qualquer mudança.

---

### Task 1: Selo de proprietário (bug 1) + dado divergente (bug 2)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts` (`listCondominiosMorador`, ~linha 632)
- Test: `click-cond-web/apps/api/src/app/auth/condominios-morador-apto-tipo.spec.ts` (novo)
- Modify: `click-cond-app/click-cond-app/lib/pages/singleton.dart:25-29`
- Test: `click-cond-app/click-cond-app/test/singleton_proprietario_test.dart` (novo)

- [ ] **Step 1: Teste da API falhando** — `listCondominiosMorador` deve devolver `apto_tipo` do vínculo.

```ts
import { MobileAuthService } from './mobile-auth.service';

describe('listCondominiosMorador — apto_tipo', () => {
  it('devolve o tipo do vínculo em Apartamentos_Users', async () => {
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: {
        findMany: jest.fn(async () => [{
          tipo: 'inquilino', vencimento: null,
          apartamento: { id: 7, apto: '106', bloco: 'A',
            condominio: { id: 1, nome: 'Boa vista', ativo: 1, financeiro: [], num_blocos: 1, num_aptos: 1 } },
        }]),
      },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;
    const [item] = await svc.listCondominiosMorador(41);
    expect(item.apto_tipo).toBe('inquilino');
  });
});
```

- [ ] **Step 2:** rodar e ver falhar (`apto_tipo` undefined).
- [ ] **Step 3:** em `listCondominiosMorador`, no objeto retornado junto de `apto_bloco`, adicionar `apto_tipo: r.tipo ?? null,`.
- [ ] **Step 4:** rodar e ver passar.
- [ ] **Step 5: App** — `isProprietarioApto()` passa a exigir tipo explícito:

```dart
bool isProprietarioApto() {
  final t = (apto_tipo ?? '').toString().toLowerCase().trim()
      .replaceAll('á', 'a');
  return t == 'proprietario';
}
```

Teste `test/singleton_proprietario_test.dart`:

```dart
import 'package:click/pages/singleton.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('só proprietário explícito é dono do apto', () {
    final s = Singleton.instance;
    for (final (tipo, esperado) in [
      ('proprietario', true), ('Proprietário', true),
      ('membro', false), ('inquilino', false), ('dependente', false),
      (null, false), ('', false),
    ]) {
      s.apto_tipo = tipo;
      expect(s.isProprietarioApto(), esperado, reason: '$tipo');
    }
  });
}
```

- [ ] **Step 6:** `flutter test test/singleton_proprietario_test.dart` passa.
- [ ] **Step 7: Dado (bug 2)** — aplicado no deploy (Task 10): `UPDATE Apartamentos_Users SET tipo='proprietario' WHERE id=45 AND id_user=41 AND tipo='membro';` (único divergente, auditado em 28/09).
- [ ] **Step 8:** commit `fix(morador): apto_tipo na lista do morador e selo de proprietário só com vínculo explícito`.

### Task 2: Telefone do cadastro web (bug 3)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/moradores/moradores.service.ts:872-887`
- Test: `click-cond-web/apps/api/src/app/moradores/moradores-telefone.spec.ts` (novo; seguir o molde de `moradores-credentials.spec.ts` para montar o serviço)

- [ ] **Step 1:** teste: `create({ nome, telefone: '17991234568', id_apartamento: 7, id_condominio: 1, tipo: 'inquilino' })` → `prisma.moradores.create` chamado com `data.telefone === '17991234568'`.
- [ ] **Step 2:** ver falhar.
- [ ] **Step 3:** em `prisma.moradores.create({ data: { ... } })` adicionar `telefone: dto.telefone?.trim() || null,` logo após `email`.
- [ ] **Step 4:** ver passar; rodar `moradores-*.spec.ts` inteiros.
- [ ] **Step 5:** commit `fix(moradores): gravar telefone no cadastro pelo console`.

### Task 3: "X no local" e contador de presença (bug 19)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts` (`getSummary`, ramo Morador ~1026-1097)
- Test: `click-cond-web/apps/api/src/app/auth/summary-morador-inside.spec.ts` (novo)
- Modify: `click-cond-app/click-cond-app/lib/pages/sindico/list_condominiums.dart:1900-1911`

- [ ] **Step 1:** teste: com `pessoasMigrationEnabled` ativo (mock de `visitas.count` que devolve 2 para a 1ª chamada e 1 para a 2ª), o retorno do morador tem `inside_condo: 1`. A 2ª chamada deve usar `where: { id_apartamento: { in: [7] }, data_entrada: { not: null }, data_saida: null }`.
- [ ] **Step 2:** ver falhar.
- [ ] **Step 3:** no ramo Morador, após `visitsCount`:

```ts
const insideWhere = {
  id_apartamento: { in: aptoIds },
  data_entrada: { not: null },
  data_saida: null,
};
const insideCount = pessoasMigrationEnabled(this.prisma)
  ? await this.prisma.visitas.count({ where: insideWhere })
  : await this.prisma.visitantes.count({ where: insideWhere });
```

e devolver `{ visits: visitsCount, packages: packagesCount, inside_condo: insideCount }`.
- [ ] **Step 4:** ver passar.
- [ ] **Step 5: App** — no fallback da linha 1910 trocar para só presença real:

```dart
noLocalCount = int.tryParse((summary?['inside_condo'] ?? summary?['visitantesAtivos'])?.toString() ?? '0') ?? 0;
```

- [ ] **Step 6:** commit `fix(home): selo "no local" conta só quem está dentro`.

### Task 4: Push de comunicado e de resposta/status de ocorrência (bug 8)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/comunicados/comunicados.service.ts` (construtor + `create`)
- Modify: `click-cond-web/apps/api/src/app/comunicados/comunicados.permissao.spec.ts:36` (4º argumento)
- Test: `click-cond-web/apps/api/src/app/comunicados/comunicados-push.spec.ts` (novo)
- Modify: `click-cond-web/apps/api/src/app/ocorrencias/ocorrencias.service.ts` (`updateStatus`, `updateResposta`)
- Test: `click-cond-web/apps/api/src/app/ocorrencias/ocorrencias-push.spec.ts` (novo)

- [ ] **Step 1:** teste comunicado: `create` com operador síndico → `notifications.sendPushNotification` chamado para cada `fcm_token` devolvido por `prisma.users.findMany` (mock com 2 tokens), título `Novo comunicado`, corpo = título do comunicado, `data.type === 'comunicado'`. `findMany` recebe `where: { notif_comunicados: 1, fcm_token: { not: null }, moradores: { some: { id_condominio: 1 } } }`.
- [ ] **Step 2:** teste ocorrência: `updateResposta(7, 'vamos trocar hoje', sindico)` com ocorrência `{ id: 7, user: 41 }` e `users.findUnique` → `{ fcm_token: 'tok', notif_ocorrencias: 1 }` ⇒ push `Ocorrência respondida` / corpo com a resposta; com `notif_ocorrencias: 0` ⇒ sem push. `updateStatus(7, 'Solucionado', sindico)` ⇒ push `Ocorrência atualizada` / `Sua ocorrência #7 agora está: Solucionado.`.
- [ ] **Step 3:** ver ambos falharem.
- [ ] **Step 4: Comunicados** — injetar `private readonly notifications: NotificationsService` (módulo é `@Global`), e ao fim de `create`, antes do `return`:

```ts
void this.notificarMoradores(dto.id_condominio, criado.titulo, criado.id);
```

```ts
private async notificarMoradores(idCondominio: number, titulo: string, id: number) {
  try {
    const users = await this.prisma.users.findMany({
      where: { notif_comunicados: 1, fcm_token: { not: null }, moradores: { some: { id_condominio: idCondominio } } },
      select: { fcm_token: true },
    });
    for (const u of users) {
      await this.notifications.sendPushNotification(u.fcm_token!, 'Novo comunicado', titulo, { type: 'comunicado', id: String(id) });
    }
  } catch (e: any) {
    this.logger.error(`[comunicados.push] ${e?.message ?? e}`);
  }
}
```

(adicionar `private readonly logger = new Logger(ComunicadosService.name);`). No teste, aguardar com `await new Promise(setImmediate)` antes dos `expect`.
- [ ] **Step 5: Ocorrências** — helper no serviço:

```ts
private async notificarAutor(ocorrenciaId: number, idUser: number | null | undefined, titulo: string, corpo: string) {
  if (!idUser) return;
  try {
    const u = await this.prisma.users.findUnique({ where: { id: idUser }, select: { fcm_token: true, notif_ocorrencias: true } });
    if (!u?.fcm_token || u.notif_ocorrencias === 0) return;
    await this.notifications.sendPushNotification(u.fcm_token, titulo, corpo, { type: 'ocorrencia', id: String(ocorrenciaId) });
  } catch (e: any) {
    this.logger.error(`[ocorrencias.push] ${e?.message ?? e}`);
  }
}
```

`updateResposta`: guardar o resultado do `update`, chamar `await this.notificarAutor(id, atualizado.user, 'Ocorrência respondida', resposta.slice(0, 140))` e retornar. `updateStatus`: idem com `'Ocorrência atualizada'`, `` `Sua ocorrência #${id} agora está: ${status}.` ``.
- [ ] **Step 6:** atualizar `comunicados.permissao.spec.ts` para `new ComunicadosService(prisma, auditoria as any, tenant as any, { sendPushNotification: jest.fn() } as any)`; rodar `comunicados/` e `ocorrencias/` inteiros.
- [ ] **Step 7:** commit `feat(push): avisar comunicado novo e resposta/status de ocorrência`.

### Task 5: Horários livres por interseção (bug 11)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/areas-sociais/areas-sociais.service.ts:580-593`
- Test: `click-cond-web/apps/api/src/app/areas-sociais/horarios-livres-sobreposicao.spec.ts` (novo)

- [ ] **Step 1:** teste unitário do filtro extraído: bloco `08:00–23:59` com reserva ativa `14:00–18:00` no mesmo dia ⇒ removido; bloco `19:00–22:00` ⇒ mantido.
- [ ] **Step 2:** ver falhar.
- [ ] **Step 3:** extrair e usar:

```ts
export function blocoColideComReserva(bloco: { horarioDe: string; horarioAte: string }, ag: { horaDe: string; horaAte: string }): boolean {
  const min = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  return min(bloco.horarioDe) < min(ag.horaAte) && min(bloco.horarioAte) > min(ag.horaDe);
}
```

e no `forEach`: `.filter(h => !blocoColideComReserva(h, ag))`.
- [ ] **Step 4:** ver passar; rodar `areas-sociais/` inteiro.
- [ ] **Step 5:** commit `fix(areas-sociais): horário livre some quando sobrepõe reserva ativa`.

### Task 6: Validação de placa (bug 12)

**Files:**
- Create: `click-cond-web/apps/api/src/app/common/placa.util.ts`
- Test: `click-cond-web/apps/api/src/app/common/placa.util.spec.ts`
- Modify: `click-cond-web/apps/api/src/app/veiculos/veiculos.service.ts` (`create`, `update`)
- Modify: `click-cond-web/apps/api/src/app/auth/mobile-auth.service.ts:4656-4657` e `4721-4723`

- [ ] **Step 1:** teste:

```ts
import { validarPlaca } from './placa.util';
describe('validarPlaca', () => {
  it.each(['ABC1234', 'abc-1234', 'ABC1D23', 'abc1d23'])('aceita %s', (p) => {
    expect(validarPlaca(p)).toBe(p.replace(/[^a-z0-9]/gi, '').toUpperCase());
  });
  it.each(['X1', 'ABC123', 'AB12345', 'ABCD123'])('recusa %s', (p) => {
    expect(() => validarPlaca(p)).toThrow('Placa inválida');
  });
});
```

- [ ] **Step 2:** ver falhar.
- [ ] **Step 3:**

```ts
import { BadRequestException } from '@nestjs/common';

/** Aceita o padrão antigo (AAA9999) e o Mercosul (AAA9A99). Devolve normalizada. */
export function validarPlaca(placa: string | null | undefined): string {
  const p = (placa ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p)) {
    throw new BadRequestException('Placa inválida. Use o formato ABC1234 ou ABC1D23.');
  }
  return p;
}
```

- [ ] **Step 4:** em `VeiculosService.create/update`, trocar `if (!data.placa) throw ...` por `data.placa = validarPlaca(data.placa);`. Em `mobile-auth.service.ts`, trocar as duas ocorrências de `if (!placa) throw ...` por `const placaOk = validarPlaca(placa);` e usar `placaOk` no `data`.
- [ ] **Step 5:** rodar `common/placa.util.spec.ts` e specs de `veiculos`/`auth` que mencionem placa.
- [ ] **Step 6:** commit `fix(veiculos): validar formato da placa`.

### Task 7: Enquete com término antes do início (bug 14)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/assembleias/assembleias.service.ts:281-283`
- Test: `click-cond-web/apps/api/src/app/assembleias/votacao-datas.spec.ts` (novo)

- [ ] **Step 1:** teste: `insertVotacao({ titulo:'x', data_inicio:'28/09/2026', data_termino:'20/09/2026', opcoes:['a','b'] }, 1, sindico)` rejeita com `BadRequestException` e não chama `votacoes.create`; mesmas datas iguais passam.
- [ ] **Step 2:** ver falhar.
- [ ] **Step 3:** após calcular `dIni`/`dFim`:

```ts
if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime())) {
  throw new BadRequestException('Datas da votação inválidas.');
}
if (dFim < dIni) {
  throw new BadRequestException('A data de término não pode ser anterior à data de início.');
}
```

- [ ] **Step 4:** ver passar; rodar `assembleias/`.
- [ ] **Step 5:** commit `fix(enquetes): recusar término antes do início`.

### Task 8: Console web (bugs 5, 9, 13, 17, 18)

**Files:**
- Modify: `click-cond-web/apps/portaria-web/src/app/moradores/moradores-page.component.ts:479-487` e `.html` (input de e-mail, ~linha 221)
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.component.ts` (`getStatusVisitante`)
- Modify: `click-cond-web/apps/portaria-web/src/app/visitantes/visitantes-page.status.spec.ts`
- Modify: `click-cond-web/apps/portaria-web/src/app/veiculos/veiculos-page.component.ts:96-107`
- Modify: `click-cond-web/apps/portaria-web/src/app/ocorrencias/ocorrencias-page.component.ts:73-76`
- Modify: rótulos de status do Delivery (buscar `AGUARDANDO AUTORIZACAO` no `portaria-web`)

- [ ] **Step 1 (17):** teste em `visitantes-page.status.spec.ts`:

```ts
it('liberado com janela ainda não iniciada é "agendado"', () => {
  const futuro = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const fim = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const v: any = { liberado: 1, data_entrada: null, data_saida: null, data_hora_inicio: futuro, data_hora_termino: fim };
  expect(tela.getStatusVisitante(v)).toBe('agendado');
});
```

ver falhar; em `getStatusVisitante`, antes do passo "4. Pré-autorizado", inserir:

```ts
if (v.data_hora_inicio && new Date(v.data_hora_inicio).getTime() > Date.now()) return 'agendado';
```

ver passar (rodar os 6 specs de `visitantes-page.*`).
- [ ] **Step 2 (5):** nos dois ramos `ehMenor` de salvar, adicionar `this.novo.email = '';`. No input de e-mail do HTML, `[disabled]="isMenorDeIdade(novo.data_nascimento)"` e placeholder `Não disponível para menores de 18 anos` quando menor.
- [ ] **Step 3 (13):** em `onBuscarMorador`, descartar resposta atrasada:

```ts
next: (data) => {
  if (this.buscaMorador().trim() !== termo) return;
  this.moradoresEncontrados.set(data);
  this.buscandoMoradores.set(false);
},
```

- [ ] **Step 4 (9):** intervalo de 10000 → 30000 e pular quando a aba está oculta: `if (document.hidden) return;` no início do callback.
- [ ] **Step 5 (18):** trocar o texto exibido `AGUARDANDO AUTORIZACAO` por `AGUARDANDO AUTORIZAÇÃO` (só o rótulo; o valor do enum no backend fica igual — mapear na exibição).
- [ ] **Step 6:** `npx nx build portaria-web` sem erros.
- [ ] **Step 7:** commit `fix(console): menor sem e-mail, visita futura como agendada, busca de morador e polling`.

### Task 9: App Flutter (bugs 6, 7, 10, 16, 18)

**Files:**
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/ocorrencias/list_ocorrencias.dart`
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/ocorrencias/list_ocorrencias_todos.dart`
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/areas sociais/area_social_detail.dart:509-548`
- Create: `click-cond-app/click-cond-app/lib/utils/hora_brasilia.dart`
- Test: `click-cond-app/click-cond-app/test/hora_brasilia_test.dart`
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/visitantes/new_visitante.dart:264` (+ `data_termino` equivalente)
- Modify: `click-cond-app/click-cond-app/lib/widgets/alerts/modal_cupertino.dart` (param `maximumDate`)
- Modify: `click-cond-app/click-cond-app/lib/pages/shared/morador/new_morador.dart:484-488`
- Create: `click-cond-app/click-cond-app/lib/utils/rotulo_bloco.dart`
- Test: `click-cond-app/click-cond-app/test/rotulo_bloco_test.dart`
- Modify: usos de `Bloco $x` / `${getText('lb_bloco')} $x` listados por `grep -rn "lb_bloco')} \|Bloco \${\|'Bloco \$" lib`
- Modify: `click-cond-app/click-cond-app/lib/pages/singleton.dart` (`getCurrentMoeda`)

- [ ] **Step 1 (16):** teste:

```dart
import 'package:click/utils/hora_brasilia.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('converte instante para parede de Brasília sem fuso', () {
    final instante = DateTime.utc(2026, 9, 28, 19, 12);
    expect(paraParedeBrasilia(instante), '2026-09-28 16:12:00.000');
  });
}
```

ver falhar; criar:

```dart
import 'package:intl/intl.dart';

/// A API lê data/hora sem fuso como horário de Brasília (UTC-3, sem horário
/// de verão). Converte o instante escolhido no aparelho para esse relógio.
String paraParedeBrasilia(DateTime d) {
  final b = d.toUtc().subtract(const Duration(hours: 3));
  return DateFormat('yyyy-MM-dd HH:mm:ss.SSS').format(b);
}
```

ver passar; em `new_visitante.dart` trocar `inicio?.toString()` por `inicio == null ? null : paraParedeBrasilia(inicio)` (e o mesmo para o término).
- [ ] **Step 2 (18 — bloco):** teste:

```dart
import 'package:click/utils/rotulo_bloco.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('não duplica o prefixo', () {
    expect(rotuloBloco('Bloco A'), 'Bloco A');
    expect(rotuloBloco('bloco b'), 'bloco b');
    expect(rotuloBloco('A'), 'Bloco A');
    expect(rotuloBloco(''), '');
  });
}
```

criar `String rotuloBloco(String? b) { final s = (b ?? '').trim(); if (s.isEmpty || s == 'null') return ''; return RegExp(r'^bloco\b', caseSensitive: false).hasMatch(s) ? s : 'Bloco $s'; }` e aplicar em todos os usos listados pelo grep (`'Bloco $x'` → `rotuloBloco(x)`; `'${getText('lb_bloco')} $x'` → `rotuloBloco(x)`), incluindo `list_condominiums.dart:1794` e `my_apartamento_view.dart:213`.
- [ ] **Step 3 (18 — moeda):** `getCurrentMoeda()` → `final m = moeda.trim(); if (m.isEmpty || m.toUpperCase() == 'BRL') return "R\$"; return m;`.
- [ ] **Step 4 (7):** `ListOcorrencias` vira dono de um contador `int _versao = 0;`; as quatro abas recebem `key: ValueKey('todas-$_versao')` etc.; o `.then` do FAB faz `setState(() => _versao++)`. Em `ListOcorrenciasTodos.build`, envolver a lista em `RefreshIndicator(onRefresh: loadList, child: ...)` com `physics: const AlwaysScrollableScrollPhysics()` (inclusive no estado vazio).
- [ ] **Step 5 (10):** em `area_social_detail.dart`, antes do `if (obj['agendamentos'].isEmpty)`, calcular `final ativos = (obj['agendamentos'] as List).where((a) => ['pendente', 'aprovado'].contains((a['status'] ?? '').toString().toLowerCase())).toList();` e usar `ativos` no `isEmpty` e no `for`.
- [ ] **Step 6 (6):** `ModalCupertino` ganha `final DateTime? maximumDate;` passado ao `CupertinoDatePicker(maximumDate: widget.maximumDate, ...)`; em `new_morador.dart` passar `maximumDate: DateTime.now()`.
- [ ] **Step 7:** `flutter analyze` sem erros novos; `flutter test` dos testes novos + suíte existente.
- [ ] **Step 8:** commit `fix(app): ocorrências recarregam, reservas canceladas somem, hora de Brasília, bloco e moeda`.

### Task 10: Bug 4 (Home não atualiza) — reproduzir antes de corrigir

- [ ] **Step 1:** com o APK novo, criar encomenda no web e fazer pull-to-refresh na Home. Se o card atualizar, fechar o bug como não reproduzível.
- [ ] **Step 2:** se reproduzir, seguir superpowers:systematic-debugging (logar a resposta de `/dashboard/summary` no refresh) antes de alterar código.

### Task 11: Deploy, APK e reteste

- [ ] **Step 1:** rodar a suíte da API e do web completas; build `nx build api` e `nx build portaria-web`.
- [ ] **Step 2:** SQL do bug 2 em produção e conferência (`SELECT tipo FROM Apartamentos_Users WHERE id=45` → `proprietario`).
- [ ] **Step 3:** merge em `master`, push `master` e `main`; acompanhar `gh run list` até os deploys ficarem verdes.
- [ ] **Step 4:** `flutter build apk --release --target-platform android-x64` e instalar no emulador (`adb install -r`; se faltar espaço, `adb uninstall -k`).
- [ ] **Step 5:** retestar no web + emulador cada bug corrigido e atualizar `docs/testes/2026-09-28-varredura-web-app.md` com o status.
