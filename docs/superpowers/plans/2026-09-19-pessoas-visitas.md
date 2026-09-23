# Pessoas + Visitas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar a identidade humana de visitantes e prestadores (`Pessoas`) das suas autorizações de acesso pontuais (`Visitas`), eliminando o algoritmo de adivinhação em memória de 358 linhas, o teto de 5.000 registros e a duplicação de biometria facial nos terminais físicos, mantendo compatibilidade retroativa total com o app v75 em produção.

**Architecture:** Modelagem em duas tabelas (`Pessoas` para identidade única com `face_id` por condomínio; `Visitas` para autorizações ligadas à pessoa e ao apartamento). Um `VisitantesAdapter` no backend mantém os contratos legados do app v75 intactos enquanto os novos módulos `PessoasModule` e `VisitasModule` atendem a versão v76+ e o painel web. O `FacialService` passa a sincronizar o `face_id` por pessoa (`pessoa_${id}`) apenas enquanto houver visita ativa.

**Tech Stack:** NestJS, Prisma ORM, MySQL, TypeScript, Jest, Flutter/Dart.

**Spec:** `docs/superpowers/specs/2026-09-19-pessoas-visitas-design.md`

## Global Constraints
- Nenhuma alteração nos contratos de API legados consumidos pelo app v75 (`/visitantes`, `/visitantes/:id`) pode quebrar respostas JSON existentes.
- Documentos de identificação (CPF/RG) devem ser sanitizados removendo pontuações (`replace(/\D/g, '')`) antes da indexação e busca.
- No hardware facial, o identificador do usuário é `pessoa_${p.id}` e cada indivíduo possui no máximo 1 cadastro biométrico ativo no terminal.
- Todos os testes unitários e de integração novos devem ser escritos com Jest no padrão NestJS e executados com sucesso.
- A suíte de regressão global de 112 arquivos de teste do backend deve continuar passando 100%.

---

### Task 1: Prisma Schema & Tipos das Tabelas `Pessoas` e `Visitas`

**Files:**
- Modify: `click-cond-web/prisma/schema.prisma`
- Test: `click-cond-web/apps/api/src/app/pessoas/schema-types.spec.ts`

**Interfaces:**
- Produces: Prisma Models `Pessoas` e `Visitas` com relacionamentos em `Condominios`, `Apartamentos`, `Users`, `Acessos_Facial` e `Vagas`.

- [ ] **Step 1: Escrever teste que valida existência dos modelos no Prisma Client**

Criar `click-cond-web/apps/api/src/app/pessoas/schema-types.spec.ts`:
```typescript
import { PrismaClient } from '@prisma/client';

describe('Prisma Schema: Pessoas e Visitas', () => {
  it('deve exportar delegates para pessoas e visitas no PrismaClient', () => {
    const prisma = new PrismaClient();
    expect(prisma.pessoas).toBeDefined();
    expect(prisma.visitas).toBeDefined();
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha antes da alteração do schema**

Executar no terminal:
```bash
npx jest apps/api/src/app/pessoas/schema-types.spec.ts
```
Esperado: FALHA indicando que `prisma.pessoas` é undefined ou erro de tipagem.

- [ ] **Step 3: Adicionar modelos `Pessoas` e `Visitas` em `click-cond-web/prisma/schema.prisma`**

No arquivo `click-cond-web/prisma/schema.prisma`:
1. Adicionar o modelo `Pessoas`:
```prisma
model Pessoas {
  id                Int          @id @default(autoincrement())
  id_condominio     Int
  nome              String       @db.VarChar(255)
  doc_identificacao String?      @db.VarChar(50)
  telefone          String?      @db.VarChar(50)
  foto_pessoa       String?      @db.LongText
  foto_documento    String?      @db.LongText
  tipo_pessoa       String       @default("visitante") @db.VarChar(20)
  face_id           String?      @db.VarChar(100)
  face_enrolled_at  DateTime?    @db.DateTime(0)
  face_sync_status  String?      @db.VarChar(20)
  face_sync_error   String?      @db.VarChar(500)
  bloqueado         Int          @default(0) @db.TinyInt
  created_at        DateTime     @default(now()) @db.DateTime(0)
  updated_at        DateTime     @default(now()) @updatedAt @db.DateTime(0)

  condominio        Condominios  @relation(fields: [id_condominio], references: [id], onDelete: Cascade, map: "fk_pes_cond")
  visitas           Visitas[]

  @@index([id_condominio], map: "idx_pes_cond")
  @@index([id_condominio, doc_identificacao], map: "idx_pes_cond_doc")
  @@index([id_condominio, nome], map: "idx_pes_cond_nome")
  @@map("pessoas")
}
```

2. Adicionar o modelo `Visitas`:
```prisma
model Visitas {
  id                 Int          @id @default(autoincrement())
  id_pessoa          Int
  id_condominio      Int
  id_apartamento     Int
  user               Int?
  is_visitante       Int          @default(1) @db.TinyInt
  is_prestador       Int          @default(0) @db.TinyInt
  data_hora_inicio   DateTime?    @db.DateTime(0)
  data_hora_termino  DateTime?    @db.DateTime(0)
  data_entrada       DateTime?    @db.DateTime(0)
  data_saida         DateTime?    @db.DateTime(0)
  codigo_acesso      String?      @db.VarChar(50)
  liberado           Int          @default(1) @db.TinyInt
  bloqueado          Int          @default(0) @db.TinyInt
  avisar             Int          @default(1) @db.TinyInt
  tag_rfid           String?      @db.VarChar(50)
  dias_semana        String?      @db.VarChar(100)
  categorias         String?      @db.VarChar(500)
  auth_status        String?      @db.VarChar(20)
  auth_solicitado_em DateTime?    @db.DateTime(0)
  auth_respondido_em DateTime?    @db.DateTime(0)
  auth_respondido_por Int?
  created_at         DateTime     @default(now()) @db.DateTime(0)
  updated_at         DateTime     @default(now()) @updatedAt @db.DateTime(0)

  pessoa             Pessoas      @relation(fields: [id_pessoa], references: [id], onDelete: Cascade, map: "fk_visita_pessoa")
  condominio         Condominios  @relation(fields: [id_condominio], references: [id], onDelete: Cascade, map: "fk_visita_cond")
  apartamento        Apartamentos @relation(fields: [id_apartamento], references: [id], onDelete: Cascade, map: "fk_visita_apto")
  criadoPor          Users?       @relation("VisitasUser", fields: [user], references: [id], map: "fk_visita_user")

  @@index([id_pessoa], map: "idx_visita_pessoa")
  @@index([id_condominio, data_entrada], map: "idx_visita_cond_entrada")
  @@index([id_apartamento], map: "idx_visita_apto")
  @@index([id_condominio, codigo_acesso], map: "idx_visita_cond_pin")
  @@map("visitas")
}
```

3. Adicionar as relações inversas em `Condominios` (`pessoas Pessoas[]`, `visitas Visitas[]`), em `Apartamentos` (`visitas Visitas[]`), em `Users` (`visitas Visitas[] @relation("VisitasUser")`).
4. Executar geração do cliente Prisma:
```bash
npx prisma generate
```

- [ ] **Step 4: Executar teste para verificar aprovação**

```bash
npx jest apps/api/src/app/pessoas/schema-types.spec.ts
```
Esperado: PASS.

- [ ] **Step 5: Commit da Task 1**

```bash
git add click-cond-web/prisma/schema.prisma click-cond-web/apps/api/src/app/pessoas/schema-types.spec.ts
git commit -m "feat(prisma): add Pessoas and Visitas models to schema"
```

---

### Task 2: Implementação do Módulo `PessoasService`

**Files:**
- Create: `click-cond-web/apps/api/src/app/pessoas/pessoas.service.ts`
- Create: `click-cond-web/apps/api/src/app/pessoas/pessoas.controller.ts`
- Create: `click-cond-web/apps/api/src/app/pessoas/pessoas.module.ts`
- Create: `click-cond-web/apps/api/src/app/pessoas/dto/criar-pessoa.dto.ts`
- Test: `click-cond-web/apps/api/src/app/pessoas/pessoas.service.spec.ts`

**Interfaces:**
- Produces:
  - `PessoasService.buscarPessoas(idCondominio: number, search?: string)`
  - `PessoasService.obterOuCriar(idCondominio: number, dto: CriarPessoaDto)`
  - `PessoasService.obterHistorico(idPessoa: number)`
  - `PessoasService.atualizarBiometria(idPessoa: number, faceId: string, status?: string)`

- [ ] **Step 1: Escrever teste de unidade para `PessoasService`**

Criar `click-cond-web/apps/api/src/app/pessoas/pessoas.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PessoasService } from './pessoas.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PessoasService', () => {
  let service: PessoasService;
  let prisma: PrismaService;

  const mockPrisma = {
    pessoas: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    visitas: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PessoasService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PessoasService>(PessoasService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('deve normalizar CPF e reaproveitar pessoa existente com mesmo CPF no condomínio', async () => {
    const pessoaExistente = {
      id: 42,
      id_condominio: 1,
      nome: 'Rodrigo Antigo',
      doc_identificacao: '12345678900',
      telefone: null,
      foto_pessoa: 'http://foto.jpg',
    };
    mockPrisma.pessoas.findFirst.mockResolvedValue(pessoaExistente);
    mockPrisma.pessoas.update.mockResolvedValue({ ...pessoaExistente, telefone: '11999999999' });

    const resultado = await service.obterOuCriar(1, {
      nome: 'Rodrigo Atualizado',
      doc_identificacao: '123.456.789-00',
      telefone: '11999999999',
    });

    expect(mockPrisma.pessoas.findFirst).toHaveBeenCalledWith({
      where: {
        id_condominio: 1,
        doc_identificacao: '12345678900',
      },
    });
    expect(resultado.id).toBe(42);
    expect(mockPrisma.pessoas.update).toHaveBeenCalled();
  });

  it('deve criar nova Pessoa quando CPF não existir', async () => {
    mockPrisma.pessoas.findFirst.mockResolvedValue(null);
    mockPrisma.pessoas.create.mockResolvedValue({
      id: 99,
      id_condominio: 1,
      nome: 'Novo Visitante',
      doc_identificacao: '98765432100',
    });

    const resultado = await service.obterOuCriar(1, {
      nome: 'Novo Visitante',
      doc_identificacao: '987.654.321-00',
    });

    expect(resultado.id).toBe(99);
    expect(mockPrisma.pessoas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_condominio: 1,
        nome: 'Novo Visitante',
        doc_identificacao: '98765432100',
      }),
    });
  });

  it('deve listar histórico de visitas de uma pessoa', async () => {
    mockPrisma.visitas.findMany.mockResolvedValue([
      { id: 10, id_pessoa: 42, data_entrada: new Date('2026-09-01') },
      { id: 11, id_pessoa: 42, data_entrada: new Date('2026-09-10') },
    ]);

    const historico = await service.obterHistorico(42);
    expect(historico).toHaveLength(2);
    expect(mockPrisma.visitas.findMany).toHaveBeenCalledWith({
      where: { id_pessoa: 42 },
      include: expect.any(Object),
      orderBy: { created_at: 'desc' },
    });
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha**

```bash
npx jest apps/api/src/app/pessoas/pessoas.service.spec.ts
```
Esperado: FALHA com módulo não encontrado.

- [ ] **Step 3: Implementar `PessoasService`, DTOs e `PessoasController`**

1. Criar `click-cond-web/apps/api/src/app/pessoas/dto/criar-pessoa.dto.ts`:
```typescript
export interface CriarPessoaDto {
  id_pessoa?: number;
  nome: string;
  doc_identificacao?: string | null;
  telefone?: string | null;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  tipo_pessoa?: 'visitante' | 'prestador';
  face_id?: string | null;
}
```

2. Criar `click-cond-web/apps/api/src/app/pessoas/pessoas.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CriarPessoaDto } from './dto/criar-pessoa.dto';

@Injectable()
export class PessoasService {
  constructor(private readonly prisma: PrismaService) {}

  static normalizarDoc(doc?: string | null): string | null {
    if (!doc) return null;
    const limpo = doc.replace(/\D/g, '').trim();
    return limpo.length > 0 ? limpo : null;
  }

  async buscarPessoas(idCondominio: number, search?: string) {
    const docLimpo = PessoasService.normalizarDoc(search);
    return this.prisma.pessoas.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                ...(docLimpo ? [{ doc_identificacao: { contains: docLimpo } }] : []),
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      take: 50,
    });
  }

  async obterOuCriar(idCondominio: number, dto: CriarPessoaDto) {
    if (dto.id_pessoa) {
      const existente = await this.prisma.pessoas.findFirst({
        where: { id: dto.id_pessoa, id_condominio: Number(idCondominio) },
      });
      if (existente) return existente;
    }

    const docLimpo = PessoasService.normalizarDoc(dto.doc_identificacao);

    if (docLimpo) {
      const existentePorDoc = await this.prisma.pessoas.findFirst({
        where: {
          id_condominio: Number(idCondominio),
          doc_identificacao: docLimpo,
        },
      });

      if (existentePorDoc) {
        const updateData: any = {};
        if (dto.telefone && !existentePorDoc.telefone) updateData.telefone = dto.telefone;
        if (dto.foto_pessoa && !existentePorDoc.foto_pessoa) updateData.foto_pessoa = dto.foto_pessoa;
        if (dto.face_id && !existentePorDoc.face_id) updateData.face_id = dto.face_id;

        if (Object.keys(updateData).length > 0) {
          return this.prisma.pessoas.update({
            where: { id: existentePorDoc.id },
            data: updateData,
          });
        }
        return existentePorDoc;
      }
    }

    return this.prisma.pessoas.create({
      data: {
        id_condominio: Number(idCondominio),
        nome: dto.nome.trim(),
        doc_identificacao: docLimpo,
        telefone: dto.telefone ?? null,
        foto_pessoa: dto.foto_pessoa ?? null,
        foto_documento: dto.foto_documento ?? null,
        tipo_pessoa: dto.tipo_pessoa ?? 'visitante',
        face_id: dto.face_id ?? null,
      },
    });
  }

  async obterHistorico(idPessoa: number) {
    return this.prisma.visitas.findMany({
      where: { id_pessoa: Number(idPessoa) },
      include: {
        apartamento: { select: { id: true, bloco: true, apto: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async atualizarBiometria(idPessoa: number, faceId: string, status = 'synced', erro: string | null = null) {
    return this.prisma.pessoas.update({
      where: { id: Number(idPessoa) },
      data: {
        face_id: faceId,
        face_enrolled_at: new Date(),
        face_sync_status: status,
        face_sync_error: erro,
      },
    });
  }
}
```

3. Criar `click-cond-web/apps/api/src/app/pessoas/pessoas.controller.ts` e `pessoas.module.ts`. Registrar `PessoasModule` no `app.module.ts`.

- [ ] **Step 4: Executar teste de unidade para verificar aprovação**

```bash
npx jest apps/api/src/app/pessoas/pessoas.service.spec.ts
```
Esperado: PASS.

- [ ] **Step 5: Commit da Task 2**

```bash
git add click-cond-web/apps/api/src/app/pessoas/
git commit -m "feat(pessoas): implement PessoasService and PessoasModule"
```

---

### Task 3: Implementação do Módulo `VisitasService`

**Files:**
- Create: `click-cond-web/apps/api/src/app/visitas/visitas.service.ts`
- Create: `click-cond-web/apps/api/src/app/visitas/visitas.controller.ts`
- Create: `click-cond-web/apps/api/src/app/visitas/visitas.module.ts`
- Create: `click-cond-web/apps/api/src/app/visitas/dto/criar-visita.dto.ts`
- Test: `click-cond-web/apps/api/src/app/visitas/visitas.service.spec.ts`

**Interfaces:**
- Consumes: `PessoasService.obterOuCriar`
- Produces:
  - `VisitasService.criarVisita(dto: CriarVisitaDto)`
  - `VisitasService.registrarEntrada(idVisita: number)`
  - `VisitasService.registrarSaida(idVisita: number)`
  - `VisitasService.listarPresenca(idCondominio: number)`
  - `VisitasService.buscarPorPin(idCondominio: number, pin: string)`

- [ ] **Step 1: Escrever teste de unidade para `VisitasService`**

Criar `click-cond-web/apps/api/src/app/visitas/visitas.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { VisitasService } from './visitas.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { PrismaService } from '../prisma/prisma.service';

describe('VisitasService', () => {
  let service: VisitasService;
  let pessoasService: PessoasService;

  const mockPrisma = {
    visitas: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPessoasService = {
    obterOuCriar: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitasService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PessoasService, useValue: mockPessoasService },
      ],
    }).compile();

    service = module.get<VisitasService>(VisitasService);
    pessoasService = module.get<PessoasService>(PessoasService);
    jest.clearAllMocks();
  });

  it('deve criar uma visita vinculando à pessoa retornada pelo PessoasService', async () => {
    mockPessoasService.obterOuCriar.mockResolvedValue({ id: 50, nome: 'Visitante Teste' });
    mockPrisma.visitas.create.mockResolvedValue({
      id: 100,
      id_pessoa: 50,
      id_condominio: 1,
      id_apartamento: 101,
      codigo_acesso: '1234',
      liberado: 1,
    });

    const visita = await service.criarVisita({
      id_condominio: 1,
      id_apartamento: 101,
      pessoa: { nome: 'Visitante Teste', doc_identificacao: '11122233344' },
      codigo_acesso: '1234',
    });

    expect(mockPessoasService.obterOuCriar).toHaveBeenCalledWith(1, {
      nome: 'Visitante Teste',
      doc_identificacao: '11122233344',
    });
    expect(visita.id).toBe(100);
    expect(visita.id_pessoa).toBe(50);
  });

  it('deve registrar entrada preenchendo data_entrada', async () => {
    mockPrisma.visitas.update.mockResolvedValue({
      id: 100,
      data_entrada: new Date(),
    });

    const res = await service.registrarEntrada(100);
    expect(mockPrisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { data_entrada: expect.any(Date) },
    });
  });

  it('deve registrar saída preenchendo data_saida', async () => {
    mockPrisma.visitas.update.mockResolvedValue({
      id: 100,
      data_saida: new Date(),
    });

    const res = await service.registrarSaida(100);
    expect(mockPrisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { data_saida: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha**

```bash
npx jest apps/api/src/app/visitas/visitas.service.spec.ts
```
Esperado: FALHA com módulo não encontrado.

- [ ] **Step 3: Implementar `VisitasService`, DTOs e `VisitasModule`**

1. Criar `click-cond-web/apps/api/src/app/visitas/dto/criar-visita.dto.ts`:
```typescript
import { CriarPessoaDto } from '../../pessoas/dto/criar-pessoa.dto';

export interface CriarVisitaDto {
  id_condominio: number;
  id_apartamento: number;
  user?: number | null;
  pessoa: CriarPessoaDto;
  is_visitante?: number;
  is_prestador?: number;
  data_hora_inicio?: Date | string | null;
  data_hora_termino?: Date | string | null;
  codigo_acesso?: string | null;
  liberado?: number;
  avisar?: number;
  tag_rfid?: string | null;
  dias_semana?: string | null;
  categorias?: string | null;
}
```

2. Criar `click-cond-web/apps/api/src/app/visitas/visitas.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { CriarVisitaDto } from './dto/criar-visita.dto';

@Injectable()
export class VisitasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pessoasService: PessoasService,
  ) {}

  async criarVisita(dto: CriarVisitaDto) {
    const pessoa = await this.pessoasService.obterOuCriar(dto.id_condominio, dto.pessoa);

    const inicio = dto.data_hora_inicio ? new Date(dto.data_hora_inicio) : null;
    const termino = dto.data_hora_termino ? new Date(dto.data_hora_termino) : null;

    return this.prisma.visitas.create({
      data: {
        id_pessoa: pessoa.id,
        id_condominio: Number(dto.id_condominio),
        id_apartamento: Number(dto.id_apartamento),
        user: dto.user ? Number(dto.user) : null,
        is_visitante: dto.is_visitante ?? 1,
        is_prestador: dto.is_prestador ?? 0,
        data_hora_inicio: inicio,
        data_hora_termino: termino,
        codigo_acesso: dto.codigo_acesso ?? null,
        liberado: dto.liberado ?? 1,
        avisar: dto.avisar ?? 1,
        tag_rfid: dto.tag_rfid ?? null,
        dias_semana: dto.dias_semana ?? null,
        categorias: dto.categorias ?? null,
      },
      include: {
        pessoa: true,
        apartamento: true,
      },
    });
  }

  async registrarEntrada(idVisita: number) {
    return this.prisma.visitas.update({
      where: { id: Number(idVisita) },
      data: { data_entrada: new Date() },
      include: { pessoa: true, apartamento: true },
    });
  }

  async registrarSaida(idVisita: number) {
    return this.prisma.visitas.update({
      where: { id: Number(idVisita) },
      data: { data_saida: new Date() },
      include: { pessoa: true, apartamento: true },
    });
  }

  async listarPresenca(idCondominio: number) {
    return this.prisma.visitas.findMany({
      where: {
        id_condominio: Number(idCondominio),
        data_entrada: { not: null },
        data_saida: null,
      },
      include: {
        pessoa: true,
        apartamento: true,
      },
      orderBy: { data_entrada: 'desc' },
    });
  }

  async buscarPorPin(idCondominio: number, pin: string) {
    return this.prisma.visitas.findFirst({
      where: {
        id_condominio: Number(idCondominio),
        codigo_acesso: pin,
        liberado: 1,
        bloqueado: 0,
      },
      include: {
        pessoa: true,
        apartamento: true,
      },
    });
  }
}
```

3. Criar `VisitasController`, `VisitasModule` e registrar no `app.module.ts`.

- [ ] **Step 4: Executar teste de unidade para verificar aprovação**

```bash
npx jest apps/api/src/app/visitas/visitas.service.spec.ts
```
Esperado: PASS.

- [ ] **Step 5: Commit da Task 3**

```bash
git add click-cond-web/apps/api/src/app/visitas/
git commit -m "feat(visitas): implement VisitasService and VisitasModule"
```

---

### Task 4: Adapter de Compatibilidade Retroativa (`VisitantesAdapter`)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/visitantes/visitantes.service.ts`
- Modify: `click-cond-web/apps/api/src/app/visitantes/visitantes.controller.ts`
- Test: `click-cond-web/apps/api/src/app/visitantes/visitantes-adapter.spec.ts`

**Interfaces:**
- Consumes: `VisitasService`, `PessoasService`
- Produces: Contrato JSON 100% idêntico ao legado esperado pelo app v75 em `GET /visitantes` e `POST /visitantes`.

- [ ] **Step 1: Escrever teste de regressão e compatibilidade do Adapter**

Criar `click-cond-web/apps/api/src/app/visitantes/visitantes-adapter.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';
import { PrismaService } from '../prisma/prisma.service';

describe('VisitantesAdapter (Compatibilidade v75)', () => {
  let service: VisitantesService;

  const mockPrisma = {
    visitas: { findMany: jest.fn(), findUnique: jest.fn() },
    visitantes: { findMany: jest.fn() },
    vagas: { findMany: jest.fn().mockResolvedValue([]) },
    isConnected: true,
  };

  const mockPessoasService = {
    obterOuCriar: jest.fn(),
  };

  const mockVisitasService = {
    criarVisita: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitantesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PessoasService, useValue: mockPessoasService },
        { provide: VisitasService, useValue: mockVisitasService },
        // outros mocks necessários para StorageService, FacialService, etc.
      ],
    }).compile();

    service = module.get<VisitantesService>(VisitantesService);
  });

  it('GET /visitantes deve achatar pessoa + visita retornando campos legados esperados pelo app v75', async () => {
    mockPrisma.visitas.findMany.mockResolvedValue([
      {
        id: 77,
        id_condominio: 1,
        id_apartamento: 101,
        data_hora_inicio: new Date('2026-09-19T10:00:00Z'),
        codigo_acesso: '4321',
        liberado: 1,
        data_entrada: null,
        data_saida: null,
        pessoa: {
          id: 33,
          nome: 'Carlos Visitante',
          doc_identificacao: '12345678900',
          foto_pessoa: 'http://foto.jpg',
          face_id: 'face_123',
        },
        apartamento: { id: 101, bloco: 'A', apto: '101' },
      },
    ]);

    const res = await service.listarPessoas(1);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      id: 77,
      nome: 'Carlos Visitante',
      doc_identificacao: '12345678900',
      foto_pessoa: 'http://foto.jpg',
      codigo_acesso: '4321',
      liberado: 1,
      totalVisitas: 1,
    });
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha ou comportamento legado**

```bash
npx jest apps/api/src/app/visitantes/visitantes-adapter.spec.ts
```

- [ ] **Step 3: Ajustar `VisitantesService` para delegar consultas e criações às novas tabelas**

1. Em `VisitantesService`, injetar `PessoasService` e `VisitasService`.
2. Em `listarPessoas(idCondominio, search)`:
   - Substituir o laço de adivinhação O(N^2) por uma consulta direta em `prisma.visitas.findMany({ where: ..., include: { pessoa: true, apartamento: true } })`.
   - Agrupar por `id_pessoa` garantindo que cada indivíduo apareça como 1 pessoa na listagem com suas visitas associadas e contadores reais.
3. Em `create(dto)`:
   - Se o payload vier no formato clássico, chamar `visitasService.criarVisita(...)` e devolver o objeto achado compatível.

- [ ] **Step 4: Executar testes de compatibilidade**

```bash
npx jest apps/api/src/app/visitantes/visitantes-adapter.spec.ts
```
Esperado: PASS.

- [ ] **Step 5: Executar testes existentes de visitantes para garantir regressão zero**

```bash
npx jest apps/api/src/app/visitantes/
```
Esperado: PASS em todos os arquivos de teste do módulo de visitantes.

- [ ] **Step 6: Commit da Task 4**

```bash
git add click-cond-web/apps/api/src/app/visitantes/
git commit -m "refactor(visitantes): replace in-memory heuristic with Pessoas and Visitas adapter"
```

---

### Task 5: Hardware Facial Sync por Pessoa (`FacialService`)

**Files:**
- Modify: `click-cond-web/apps/api/src/app/facial/facial.service.ts`
- Test: `click-cond-web/apps/api/src/app/facial/facial-pessoas-sync.spec.ts`

**Interfaces:**
- Consumes: `Pessoas`, `Visitas`
- Produces:
  - `FacialService.syncPessoa(idPessoa: number, opts?: { deviceIds?: number[] })`
  - `FacialService.unsyncPessoa(idPessoa: number, faceId: string, idCondominio: number)`

- [ ] **Step 1: Escrever teste de unidade para `syncPessoa`**

Criar `click-cond-web/apps/api/src/app/facial/facial-pessoas-sync.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { FacialService } from './facial.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FacialService: Sincronização por Pessoa', () => {
  let service: FacialService;

  const mockPrisma = {
    pessoas: { findUnique: jest.fn(), update: jest.fn() },
    visitas: { findMany: jest.fn() },
    facial_Devices: { findMany: jest.fn().mockResolvedValue([]) },
  };

  it('não deve enviar rosto se a pessoa não tiver nenhuma visita autorizada no momento', async () => {
    // Pessoa sem visitas válidas
    mockPrisma.pessoas.findUnique.mockResolvedValue({
      id: 10,
      id_condominio: 1,
      foto_pessoa: 'http://foto.jpg',
      face_id: 'face_10',
    });
    mockPrisma.visitas.findMany.mockResolvedValue([]); // Nenhuma visita ativa

    // Simular syncPessoa
    // Esperado: unsync ou skip
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha**

```bash
npx jest apps/api/src/app/facial/facial-pessoas-sync.spec.ts
```

- [ ] **Step 3: Implementar `syncPessoa` e `unsyncPessoa` em `FacialService`**

1. No `facial.service.ts`:
   - Adicionar método `syncPessoa(idPessoa: number, opts: { deviceIds?: number[] } = {})`.
   - Carregar pessoa e suas visitas ativas no condomínio:
     ```typescript
     const visitas = await this.prisma.visitas.findMany({
       where: { id_pessoa: idPessoa, bloqueado: 0 },
     });
     const autorizado = visitas.some(v => this.isVisitaAutorizadaAgora(v));
     ```
   - Se `autorizado`: matricular no terminal com `external_id: 'pessoa_' + idPessoa` e foto da pessoa.
   - Se não `autorizado`: se tiver `face_id`, efetuar remoção no aparelho (`unsyncPessoa`), preservando o `face_id` na tabela `Pessoas` para futuras visitas.
2. Manter `syncVisitante(idVisitante)` chamando internamente `syncPessoa(visita.id_pessoa)` para compatibilidade com chamadas existentes.

- [ ] **Step 4: Executar testes do módulo facial**

```bash
npx jest apps/api/src/app/facial/facial-pessoas-sync.spec.ts
npx jest apps/api/src/app/facial/
```
Esperado: PASS em todos os testes do módulo facial.

- [ ] **Step 5: Commit da Task 5**

```bash
git add click-cond-web/apps/api/src/app/facial/
git commit -m "feat(facial): implement person-based facial hardware synchronization"
```

---

### Task 6: Validação de Regressão Global & Build

**Files:**
- Run: Suíte de testes do NestJS (`click-cond-web/apps/api`)
- Run: Suíte de testes do Flutter (`click-cond-app`)

- [ ] **Step 1: Executar suite completa de testes da API NestJS**

Executar no diretório `click-cond-web`:
```bash
npm --prefix click-cond-web test
```
Esperado: 100% de sucesso nos 112 arquivos de teste.

- [ ] **Step 2: Executar suite de testes do aplicativo Flutter**

Executar no diretório `click-cond-app/click-cond-app`:
```bash
flutter test
```
Esperado: 100% de sucesso nos testes existentes.

- [ ] **Step 3: Commit e Tag de Finalização**

```bash
git commit --allow-empty -m "chore: complete pessoas + visitas architecture implementation"
```
