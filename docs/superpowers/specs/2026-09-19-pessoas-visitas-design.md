# Design Doc: Arquitetura Pessoas + Visitas

**Data**: 2026-09-19  
**Status**: Aprovado para Planejamento  
**Escopo**: `click-cond-web` (API NestJS / Prisma / Módulo Facial), `click-cond-app` (Adapter de Compatibilidade v75 & suporte v76+)

---

## 1. Contexto e Motivação

Atualmente, o sistema modela o conceito de visitantes através da tabela `Visitantes`. No entanto, cada linha dessa tabela representa simultaneamente:
1. **A identidade humana** (nome, CPF, documento, foto, face_id biométrico); e
2. **A autorização pontual de acesso** (apartamento de destino, data de início, data de término, código PIN, liberação, horários de entrada e saída).

### Problemas Decorrentes
* **Multiplicidade de Registros para o Mesmo Indivíduo**: Quando uma pessoa ("Rodrigo") visita o apartamento 101 e, posteriormente, visita o 202, duas linhas distintas são inseridas no banco de dados. O sistema não tem garantia estrutural de que se trata da mesma pessoa.
* **Heurística Frágil em Memória**: Para mitigar esse problema na interface, foi desenvolvido um algoritmo de aproximadamente 358 linhas no backend e no app que busca adivinhar identidades comparando strings de documentos, nomes e URLs de fotos a cada carregamento de página. Essa heurística:
  - Pode fundir pessoas diferentes que compartilham nomes idênticos;
  - Fragmenta o mesmo usuário caso haja qualquer erro de digitação no documento;
  - Gera gargalo de desempenho e tem um teto de escala reportado de ~5.000 registros por condomínio.
* **Conflitos de Biometria em Hardware Facial**: Terminais faciais físicos recebem identificadores vinculados à visita (`visitante_${v.id}`). Quando a mesma pessoa possui múltiplos agendamentos ou visitas passadas, o terminal recebe cadastros duplicados com a mesma face, gerando conflitos no dispositivo, falhas de sincronização e perda de biometria após a expiração de uma visita.

---

## 2. Decisões Arquiteturais

1. **Separação Estrutural**:
   - **`Pessoas`**: Entidade de identidade persistente no condomínio. Armazena dados cadastrais permanentes, foto e identificador biométrico (`face_id`).
   - **`Visitas`**: Entidade de evento/autorização. Aponta para uma `Pessoa` (`id_pessoa`) e para uma unidade (`id_apartamento`), guardando janelas de acesso, PIN, status de presença e histórico de entrada/saída.
2. **Escopo**: Focado em **Visitantes e Prestadores de serviço** (com e sem recorrência), unificando suas identidades sob a tabela `Pessoas`. Moradores e funcionários permanecem com suas contas de usuário no modelo existente.
3. **Compatibilidade Retroativa (App v75)**:
   - Os endpoints existentes (`/visitantes`, `/visitantes/:id`) continuam respondendo no formato esperado pelo app publicado (v75) através de uma camada de **Adapter**. O app atual continuará funcionando sem quebras.
   - Novos endpoints limpos e otimizados (`/pessoas`, `/visitas`) ficam disponíveis para o app v76+ e para o painel web/portaria.
4. **Hardware Facial (`FacialService`)**:
   - O identificador físico no terminal passa a ser `pessoa_${p.id}`.
   - A biometria é cadastrada uma única vez na `Pessoa`.
   - A ativação do rosto no terminal físico ocorre enquanto houver pelo menos uma visita válida/autorizada no momento, ou enquanto o visitante estiver fisicamente dentro do condomínio.
   - Quando todas as visitas válidas terminam, o rosto é descarregado do terminal (`unsync`), mas o template facial permanece preservado na tabela `Pessoas` para futuras visitas.
5. **Dados Existentes**: Como os dados atuais do banco de desenvolvimento/homologação são de teste, a nova estrutura de `Pessoas` + `Visitas` é adotada como padrão oficial, eliminando a dependência do algoritmo de agrupamento em memória.

---

## 3. Modelo de Dados (Prisma Schema)

### 3.1 Modelo `Pessoas`
```prisma
model Pessoas {
  id                Int          @id @default(autoincrement())
  id_condominio     Int
  nome              String       @db.VarChar(255)
  doc_identificacao String?      @db.VarChar(50)
  telefone          String?      @db.VarChar(50)
  foto_pessoa       String?      @db.LongText
  foto_documento    String?      @db.LongText
  tipo_pessoa       String       @default("visitante") @db.VarChar(20) // 'visitante' | 'prestador'
  face_id           String?      @db.VarChar(100)
  face_enrolled_at  DateTime?    @db.DateTime(0)
  face_sync_status  String?      @db.VarChar(20)
  face_sync_error   String?      @db.VarChar(500)
  bloqueado         Int          @default(0) @db.TinyInt
  created_at        DateTime     @default(now()) @db.DateTime(0)
  updated_at        DateTime     @default(now()) @updatedAt @db.DateTime(0)

  condominio        Condominios  @relation(fields: [id_condominio], references: [id], onDelete: Cascade, map: "fk_pes_cond")
  visitas           Visitas[]
  acessos_facial    Acessos_Facial[]

  @@index([id_condominio], map: "idx_pes_cond")
  @@index([id_condominio, doc_identificacao], map: "idx_pes_cond_doc")
  @@index([id_condominio, nome], map: "idx_pes_cond_nome")
  @@map("pessoas")
}
```

### 3.2 Modelo `Visitas`
```prisma
model Visitas {
  id                 Int          @id @default(autoincrement())
  id_pessoa          Int
  id_condominio      Int
  id_apartamento     Int
  user               Int?         // Usuário morador/porteiro que autorizou
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
  auth_status        String?      @db.VarChar(20) // 'pendente' | 'autorizado' | 'negado'
  auth_solicitado_em DateTime?    @db.DateTime(0)
  auth_respondido_em DateTime?    @db.DateTime(0)
  auth_respondido_por Int?
  created_at         DateTime     @default(now()) @db.DateTime(0)
  updated_at         DateTime     @default(now()) @updatedAt @db.DateTime(0)

  pessoa             Pessoas      @relation(fields: [id_pessoa], references: [id], onDelete: Cascade, map: "fk_visita_pessoa")
  condominio         Condominios  @relation(fields: [id_condominio], references: [id], onDelete: Cascade, map: "fk_visita_cond")
  apartamento        Apartamentos @relation(fields: [id_apartamento], references: [id], onDelete: Cascade, map: "fk_visita_apto")
  criadoPor          Users?       @relation("VisitasUser", fields: [user], references: [id], map: "fk_visita_user")
  vagas              Vagas[]

  @@index([id_pessoa], map: "idx_visita_pessoa")
  @@index([id_condominio, data_entrada], map: "idx_visita_cond_entrada")
  @@index([id_apartamento], map: "idx_visita_apto")
  @@index([id_condominio, codigo_acesso], map: "idx_visita_cond_pin")
  @@map("visitas")
}
```

---

## 4. Componentes e Lógica de Negócio

### 4.1 `PessoasService`
* **`buscarPessoas(idCondominio: number, search?: string)`**:
  Executa busca indexada por CPF numérico limpo ou por prefixo de nome. Retorna a lista de pessoas para preenchimento ágil na portaria e app.
* **`obterOuCriar(idCondominio: number, dados: CriarPessoaDto)`**:
  1. Se `dados.id_pessoa` for fornecido, valida se pertence ao condomínio e reutiliza.
  2. Se `dados.doc_identificacao` estiver preenchido, busca pessoa no mesmo condomínio com o mesmo documento limpo. Se encontrar, atualiza foto/telefone se fornecidos e reutiliza o ID.
  3. Caso contrário, cadastra uma nova linha em `Pessoas`.
* **`obterHistorico(idPessoa: number)`**:
  Consulta direta: `SELECT v.*, a.bloco, a.apto FROM visitas v JOIN apartamentos a ON ... WHERE v.id_pessoa = :idPessoa ORDER BY v.created_at DESC`.

### 4.2 `VisitasService`
* **`criarVisita(dto: CriarVisitaDto)`**:
  1. Chama `PessoasService.obterOuCriar` para obter a `Pessoa`.
  2. Insere o registro em `Visitas`.
  3. Se houver vaga de visitante solicitada, associa a vaga à visita.
  4. Aciona a sincronização facial (`FacialService.syncPessoa`) se a visita for imediata.
* **`registrarEntrada(idVisita: number)`**:
  1. Grava `data_entrada = new Date()`.
  2. Se `avisar = 1`, envia push notification para os moradores do apartamento.
* **`registrarSaida(idVisita: number)`**:
  1. Grava `data_saida = new Date()`.
  2. Desvincula a vaga associada (define `ativo = 0` na vaga vinculada).
  3. Chama `FacialService.syncPessoa(id_pessoa)` para avaliar se a pessoa ainda possui outras autorizações vigentes; se não possuir, remove do terminal facial físico.

### 4.3 `VisitantesAdapterService` (Compatibilidade Retroativa)
* Mantém os endpoints `/visitantes` respondendo no contrato original da interface Flutter (v75):
  - **`GET /visitantes`**: Consulta `Visitas` com `include: { pessoa: true, apartamento: true }`, achata o objeto para os campos `{ id, nome, doc_identificacao, foto_pessoa, data_hora_inicio, data_hora_termino, liberado, codigo_acesso, data_entrada, data_saida, ... }`.
  - **`POST /visitantes`**: Recebe o payload composto legado, delega a criação para `PessoasService` e `VisitasService`, e retorna o payload com o formato idêntico ao esperado pelo app v75.
  - **`PUT /visitantes/:id`** e **`DELETE /visitantes/:id`**: Direcionados para a `Visita` correspondente.

---

## 5. Módulo Facial e Dispositivos Físicos

1. **Identificador Único no Dispositivo**:
   - `external_id`: `pessoa_${p.id}`.
2. **Avaliação de Autorização**:
   ```typescript
   const temVisitaAutorizada = visitasAtivas.some(v => 
     v.bloqueado !== 1 &&
     ((v.liberado === 1 && dentroDaJanela(v) && diaAutorizado(v)) ||
      (v.data_entrada !== null && v.data_saida === null))
   );
   ```
3. **Fluxo de Sincronismo**:
   - Se `temVisitaAutorizada && pessoa.bloqueado !== 1`: envia foto/template facial ao terminal.
   - Se `!temVisitaAutorizada || pessoa.bloqueado === 1`: remove do terminal físico, mantendo os dados preservados no banco para o próximo acesso.
4. **Log de Passagem**:
   - Ao receber webhook de abertura de porta com reconhecimento facial:
     - Grava evento em `Acessos_Facial` com `id_pessoa: pessoa.id`.
     - Atualiza o status da visita correspondente em andamento.

---

## 6. Estratégia de Testes

1. **Testes de Unidade (`PessoasService`)**:
   - Testar normalização de CPF (`123.456.789-00` vs `12345678900`).
   - Testar reutilização de pessoa existente por CPF.
   - Testar criação de pessoa sem documento sem colisão indevida.
2. **Testes de Integração (`VisitasService`)**:
   - Testar agendamento com criação automática de pessoa.
   - Testar registro de entrada e saída.
   - Testar liberação automática de vaga ao registrar saída.
3. **Testes de Compatibilidade (`VisitantesAdapter`)**:
   - Validar que `GET /visitantes` devolve JSON idêntico ao esperado pelo app v75.
   - Validar que `POST /visitantes` legado persiste corretamente em `Pessoas` e `Visitas`.
4. **Testes de Facial (`FacialService`)**:
   - Validar que 2 visitas para a mesma pessoa resultam em apenas 1 cadastro facial no terminal.
   - Validar que a saída da última visita remove o usuário do terminal, mas mantém o template facial na `Pessoa`.
5. **Regressão**:
   - Execução completa da suíte de 112 arquivos de teste do NestJS para garantir zero regressão.
