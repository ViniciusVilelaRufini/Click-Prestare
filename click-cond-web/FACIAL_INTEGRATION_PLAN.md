# Plano de Integração — Terminal Facial (Opção 3)

Plano técnico para integrar o sistema Click Portaria com um terminal facial all-in-one (recomendado: **Control iD iDFace 373** ~R$ 1.800) instalado na portaria do condomínio.

---

## 1. Arquitetura Geral

```
┌─────────────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
│  Web (Angular)      │         │   Backend (NestJS)   │         │  Terminal Facial    │
│  - Cadastro morador │ ──────► │  - /moradores        │ ──────► │  Control iD iDFace  │
│  - Cadastro visit.  │  REST   │  - /visitantes       │  REST   │  - Reconhece rosto  │
│  - Status facial    │ ◄────── │  - /acessos/webhook  │ ◄────── │  - Aciona catraca   │
└─────────────────────┘         │  - FacialDeviceSvc   │         │  - Envia evento     │
                                └──────────────────────┘         └─────────────────────┘
                                          │
                                          ▼
                                ┌──────────────────────┐
                                │  MySQL (Railway)     │
                                │  - face_id           │
                                │  - data_entrada      │
                                │  - AuditLog          │
                                └──────────────────────┘
```

**Fluxo de cadastro:** Operador cadastra morador/visitante na web (com foto) → backend salva no banco → backend chama API do terminal e envia foto + id → terminal armazena template biométrico → retorna `face_id`.

**Fluxo de acesso:** Pessoa chega na portaria → terminal reconhece o rosto → terminal envia webhook para o backend com `face_id` + timestamp → backend identifica morador/visitante → grava `data_entrada` (ou `data_saida`) → registra no AuditLog → libera catraca/portão.

---

## 2. Hardware Necessário

| Item                              | Modelo Recomendado            | Custo Aprox. |
| --------------------------------- | ----------------------------- | ------------ |
| Terminal facial all-in-one        | Control iD iDFace 373         | R$ 1.800     |
| Fonte 12V + cabeamento            | —                             | R$ 150       |
| Módulo relé p/ catraca/portão     | Já incluso no terminal        | —            |
| Instalação (técnico CFTV)         | —                             | R$ 200       |
| **Total por entrada**             |                               | **R$ 2.150** |

**Requisitos do terminal:**
- IP estático na rede local do condomínio (ex.: `192.168.1.50`)
- Acesso à internet de saída (para enviar webhook ao backend em produção)
- Documentação REST API do fabricante (Control iD fornece SDK + manual API)

---

## 3. Mudanças no Banco de Dados (Prisma)

Adicionar campos para referenciar a pessoa no terminal e rastrear status de enrollment.

### 3.1. Model `Moradores` — adicionar:

```prisma
face_id          String?   @db.VarChar(100)   // ID retornado pelo terminal
face_enrolled_at DateTime? @db.DateTime(0)    // Quando o enrollment foi feito
face_sync_status String?   @db.VarChar(20)    // pending | synced | error
```

### 3.2. Model `Visitantes` — adicionar:

```prisma
face_id          String?   @db.VarChar(100)
face_enrolled_at DateTime? @db.DateTime(0)
face_sync_status String?   @db.VarChar(20)
```

### 3.3. Novo Model `Facial_Devices` (configuração de terminais):

```prisma
model Facial_Devices {
  id            Int         @id @default(autoincrement())
  id_condominio Int
  nome          String      @db.VarChar(100)        // "Portaria Principal"
  fabricante    String      @db.VarChar(50)        // "control_id"
  modelo        String?     @db.VarChar(100)
  ip            String      @db.VarChar(45)
  porta         Int         @default(80)
  api_user      String?     @db.VarChar(100)
  api_password  String?     @db.VarChar(255)       // criptografado
  webhook_token String      @db.VarChar(255)       // token p/ validar webhook
  ativo         Int         @default(1) @db.TinyInt
  ultima_sincr  DateTime?   @db.DateTime(0)
  created_at    DateTime    @default(now()) @db.DateTime(0)
  updated_at    DateTime    @default(now()) @updatedAt @db.DateTime(0)
  condominio    Condominios @relation(fields: [id_condominio], references: [id], onDelete: Cascade)

  @@index([id_condominio])
}
```

### 3.4. Novo Model `Acessos_Facial` (log de eventos):

```prisma
model Acessos_Facial {
  id              Int       @id @default(autoincrement())
  id_condominio   Int
  id_device       Int
  face_id         String    @db.VarChar(100)
  tipo_pessoa     String    @db.VarChar(20)     // morador | visitante
  id_pessoa       Int                            // referencia Moradores.id ou Visitantes.id
  nome_pessoa     String    @db.VarChar(255)
  evento          String    @db.VarChar(20)     // entrada | saida | negado
  confianca       Float?                         // score 0-1 do match facial
  timestamp       DateTime  @db.DateTime(0)
  created_at      DateTime  @default(now()) @db.DateTime(0)

  @@index([id_condominio, timestamp])
  @@index([id_pessoa, tipo_pessoa])
}
```

### 3.5. Comando de migração:

```bash
pnpm prisma migrate dev --name add_facial_integration
pnpm prisma generate
```

---

## 4. Mudanças no Backend (NestJS)

### 4.1. Novo módulo `facial/`

Estrutura:
```
apps/api/src/app/facial/
├── facial.module.ts
├── facial.controller.ts          # CRUD de devices (config) + webhook
├── facial.service.ts             # Lógica de sync + processamento de eventos
├── facial-device-client.service.ts # HTTP client p/ falar com Control iD
└── dto/
    ├── create-device.dto.ts
    ├── webhook-event.dto.ts
    └── enroll-person.dto.ts
```

### 4.2. `FacialDeviceClientService` (cliente HTTP)

Responsabilidade: traduzir chamadas do nosso modelo para o protocolo REST do Control iD.

**Métodos principais:**
- `enrollPerson(device, { id, nome, foto_base64 })` → POST `http://{ip}/persons` → retorna `face_id`
- `updatePerson(device, face_id, { foto_base64 })` → PUT `http://{ip}/persons/{face_id}`
- `removePerson(device, face_id)` → DELETE `http://{ip}/persons/{face_id}`
- `ping(device)` → GET `http://{ip}/status` (verifica conectividade)

Usa `HttpService` do `@nestjs/axios` com auth básica (api_user/api_password do `Facial_Devices`).

### 4.3. `FacialService` (orquestração)

**Métodos:**
- `syncMorador(id_morador)` — busca morador, encontra todos devices do condomínio, faz enrollment em cada um, atualiza `face_id` e `face_sync_status`
- `syncVisitante(id_visitante)` — idem para visitante
- `unsyncMorador(id_morador)` — remove do(s) terminal(is) ao deletar
- `processWebhookEvent(payload)` — recebe evento de acesso, identifica pessoa pelo `face_id`, faz check-in/check-out automático, grava `Acessos_Facial` e `AuditLog`

### 4.4. `FacialController`

**Endpoints:**

```typescript
// Configuração de devices (CRUD protegido por JWT, role: sindico)
POST   /api/facial/devices              // criar device
GET    /api/facial/devices              // listar
PUT    /api/facial/devices/:id          // atualizar
DELETE /api/facial/devices/:id          // remover
POST   /api/facial/devices/:id/test     // testar conectividade

// Operações manuais (role: sindico ou porteiro)
POST   /api/facial/sync/morador/:id     // re-sincronizar morador
POST   /api/facial/sync/visitante/:id   // re-sincronizar visitante
GET    /api/facial/acessos              // histórico de acessos faciais

// Webhook (público, validado por token)
POST   /api/facial/webhook/:token       // recebe evento do terminal
```

### 4.5. Hook nos services existentes

**`moradores.service.ts`** — após `create`, `update` (quando `foto_pessoa` muda) e `remove`:
```typescript
// pseudocódigo
async create(dto) {
  const morador = await this.prisma.moradores.create({ data: dto });
  if (morador.foto_pessoa) {
    await this.facialService.syncMorador(morador.id).catch(err =>
      this.logger.warn(`Falha sync facial morador ${morador.id}: ${err.message}`)
    );
  }
  return morador;
}
```
A sync **não deve bloquear** a operação principal — se o terminal estiver offline, marca `face_sync_status = 'pending'` e um job retenta depois.

**`visitantes.service.ts`** — análogo, e ao receber webhook de entrada, reaproveita lógica de `checkIn()` que já existe.

### 4.6. Job de retry (sync pendentes)

Criar um cron com `@nestjs/schedule` que roda a cada 5 minutos:
- Busca moradores/visitantes com `face_sync_status = 'pending'`
- Tenta re-enrollar
- Marca `synced` ou mantém `pending` se falhar novamente

### 4.7. Variáveis de ambiente novas

```bash
# .env
FACIAL_INTEGRATION_ENABLED=true
FACIAL_WEBHOOK_SECRET=<gerar string aleatória forte>
FACIAL_HTTP_TIMEOUT_MS=10000
```

---

## 5. Mudanças no Frontend (Angular)

### 5.1. Página de configuração de terminais

Nova rota: `/configuracoes/terminais-faciais`

Componente: `apps/portaria-web/src/app/configuracoes/terminais-faciais.component.ts`

Funcionalidades:
- Listar terminais cadastrados (nome, IP, status online/offline)
- Adicionar novo terminal (form com nome, IP, porta, credenciais)
- Botão "Testar Conexão" → chama `POST /facial/devices/:id/test`
- Botão "Re-sincronizar Todos" → dispara enrollment em lote

### 5.2. Indicador de status facial nos cards

**`moradores-page.component.ts`** e **`visitantes-page.component.ts`** — adicionar badge ao lado do nome:

| Status                          | Badge                   |
| ------------------------------- | ----------------------- |
| `face_sync_status = 'synced'`   | 🟢 Verde "Facial OK"    |
| `face_sync_status = 'pending'`  | 🟡 Amarelo "Sincronizando" |
| `face_sync_status = 'error'`    | 🔴 Vermelho "Erro"      |
| `foto_pessoa = null`            | ⚪ Cinza "Sem foto"     |

Botão de re-sincronizar manualmente em cada card.

### 5.3. Histórico de acessos no dashboard

Novo widget no dashboard mostrando últimos 10 acessos faciais (nome, evento, horário, terminal).

Endpoint: `GET /api/facial/acessos?limit=10`

### 5.4. Avisar usuário sobre foto obrigatória

No formulário de cadastro de morador/visitante, quando a integração facial está ativa, mostrar aviso:
> "Foto da pessoa é necessária para acesso facial automático."

---

## 6. Mudanças no Mobile (Flutter)

### 6.1. Tela de histórico de acessos do morador

Nova seção em "Meus Visitantes" mostrando quando cada visitante entrou/saiu (puxado de `Acessos_Facial`).

### 6.2. Notificação push ao morador

Quando um visitante seu entra/sai pelo terminal facial, enviar push notification:
> "João da Silva entrou no condomínio — 14:32"

Usar o `NotificationsService` existente (FCM token já está em `Users.fcm_token`).

### 6.3. Status facial do próprio morador

Mostrar se o cadastro biométrico do morador está sincronizado, com instrução para procurar a portaria caso esteja com erro.

---

## 7. Webhook — Detalhes do Endpoint

### 7.1. Formato esperado (exemplo Control iD)

```json
POST /api/facial/webhook/abc123token
Content-Type: application/json

{
  "device_id": "iDFace_001",
  "event": "access_granted",
  "person_id": "morador_42",
  "timestamp": "2026-05-27T14:32:18Z",
  "confidence": 0.94,
  "direction": "in"
}
```

### 7.2. Validação

1. Verificar token na URL contra `Facial_Devices.webhook_token`
2. Validar IP de origem (whitelist do IP do terminal — opcional)
3. Validar timestamp recente (< 60s) para evitar replay

### 7.3. Processamento

```
1. Extrai person_id → parseia formato "morador_42" ou "visitante_15"
2. Busca pessoa no banco
3. Se for visitante → chama lógica existente de checkIn/checkOut
4. Se for morador → grava em Acessos_Facial, dispara push notification
5. Cria registro em AuditLog (acao = 'CHECK_IN_FACIAL')
6. Retorna 200 OK ao terminal
```

---

## 8. Plano de Instalação Física

1. **Pré-instalação:**
   - Sindico aprova a compra
   - Definir local exato do terminal (entrada principal)
   - Verificar disponibilidade de tomada 110V e ponto de rede

2. **Aquisição:**
   - Comprar Control iD iDFace 373 (~R$ 1.800)
   - Comprar cabos, conectores, fonte

3. **Instalação física (técnico CFTV — ~4h):**
   - Fixar terminal na parede
   - Passagem de cabo até a fechadura/catraca
   - Conectar à rede do condomínio
   - Configurar IP estático
   - Testar acionamento da catraca

4. **Configuração no sistema:**
   - Sindico acessa `/configuracoes/terminais-faciais` no portal web
   - Cadastra o terminal (nome, IP, credenciais API)
   - Sistema testa conexão automaticamente

5. **Enrollment em massa:**
   - Sistema sincroniza automaticamente todos os moradores com `foto_pessoa` preenchida
   - Para moradores sem foto: solicitar via app ou capturar na portaria

6. **Go-live:**
   - Comunicado aos moradores explicando o novo sistema
   - Monitorar logs de `Acessos_Facial` na primeira semana

---

## 9. Checklist de Testes

### Backend
- [ ] Criar device → testar conexão → retorna OK
- [ ] Criar morador com foto → verificar `face_id` populado e `face_sync_status = 'synced'`
- [ ] Atualizar foto de morador → verificar re-sync no terminal
- [ ] Deletar morador → verificar remoção no terminal
- [ ] Terminal offline ao criar morador → status fica `pending`
- [ ] Job de retry recupera pendentes quando terminal volta
- [ ] Webhook com token válido → registra acesso e faz check-in
- [ ] Webhook com token inválido → retorna 401
- [ ] Webhook duplicado em <1s → deduplicar (não criar 2 entradas)

### Frontend Web
- [ ] Badge de status facial aparece corretamente nos cards
- [ ] Botão re-sincronizar funciona
- [ ] Página de configuração de terminais permite CRUD
- [ ] Histórico de acessos atualiza em tempo real (ou polling 30s)

### Mobile (Flutter)
- [ ] Morador recebe push quando visitante seu entra
- [ ] Histórico de acessos do visitante visível no app

### Integração end-to-end
- [ ] Cadastrar visitante com PIN + foto → visitante chega → terminal reconhece → catraca abre → app do morador recebe push → `data_entrada` preenchida no banco
- [ ] Visitante tenta entrar fora da janela `data_hora_inicio/termino` → terminal nega → registro de acesso negado

---

## 10. Riscos e Mitigações

| Risco                                          | Mitigação                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Terminal fica offline (queda de rede)          | Backend marca `pending`, job de retry, terminal mantém cache local |
| Falha no enrollment (foto ruim)                | Validar qualidade da foto no upload (resolução mínima 480px)     |
| Webhook não chega ao backend (NAT/firewall)    | Documentar liberação de porta + usar HTTPS público (produção)    |
| Pessoa cadastra rosto de outra (fraude)        | Sindico/porteiro deve conferir documento ao tirar foto na portaria |
| Custo alto se condomínio quiser várias entradas | Modelo `Facial_Devices` já suporta N terminais por condomínio    |
| LGPD — dados biométricos                       | Adicionar termo de consentimento no cadastro + documentar política |

---

## 11. Ordem de Implementação Sugerida

1. **Sprint 1 (1 semana)** — Banco + modelos
   - Migration do Prisma (campos `face_id`, novos models)
   - Seeds de teste

2. **Sprint 2 (2 semanas)** — Backend core
   - Módulo `facial/` (service + controller + client)
   - Hook em `moradores.service.ts` e `visitantes.service.ts`
   - Webhook endpoint + validação

3. **Sprint 3 (1 semana)** — Frontend web
   - Página de configuração de terminais
   - Badges de status nos cards
   - Histórico no dashboard

4. **Sprint 4 (3 dias)** — Mobile
   - Push notifications
   - Tela de histórico

5. **Sprint 5 (1 semana)** — Teste em hardware real
   - Comprar 1 Control iD para teste
   - Validar com dados reais
   - Ajustar protocolo conforme API real do fabricante

6. **Sprint 6 (2 dias)** — Produção
   - Deploy
   - Documentação para sindicos
   - Treinamento

**Tempo total estimado: ~6 semanas** (1 dev full-time)

---

## 12. Próximos Passos Imediatos

1. Confirmar fabricante do terminal — recomendado Control iD, alternativas: Intelbras SS 5530 FE, ZKTeco
2. Obter documentação oficial da API REST do fabricante escolhido
3. Comprar 1 unidade para desenvolvimento (pode ser via Mercado Livre ou direto do fabricante)
4. Criar branch `feat/facial-integration` no repo
5. Executar Sprint 1 (migration do schema)
