# Especificação Técnica: Autenticação em Duas Etapas (2FA / MFA) para Síndicos e Administradores

> **Status:** Arquivado para execução futura  
> **Data:** 2026-09-18  
> **Escopo:** `click-cond-web` (NestJS API + CRM Web + Portaria Web) e `click-cond-app` (Flutter Mobile)

---

## 1. Visão Geral e Propósito

Blindar o acesso de contas com privilégios elevados (**Síndicos** e **Administradores do CRM Comercial**) através de autenticação em duas etapas via código temporário de 6 dígitos enviado por e-mail (out-of-band via SMTP).

Mesmo no caso de vazamento ou comprometimento de senha, o invasor não conseguirá acesso aos sistemas sem a posse da caixa de e-mail do titular.

---

## 2. Decisões de Arquitetura Alinhadas

* **Canal de Entrega:** Código numérico de 6 dígitos enviado para o e-mail cadastrado do usuário via `MailService` (SMTP).
* **Política de Obrigatoriedade:** Obrigatório para todos os Síndicos e Administradores, com suporte ao recurso *"Lembrar deste dispositivo por 30 dias"*.
* **Plataformas Cobertas:** Portais Web (CRM Comercial e Portal do Síndico) e Aplicativo Móvel (perfil Síndico).
* **Armazenamento:** Stateful com tabelas de banco dedicadas (`Mfa_Challenges` e `User_Trusted_Devices`) para suporte nativo a múltiplas instâncias na AWS sem dependência de memória local.

---

## 3. Modelo de Dados (Prisma ORM)

```prisma
/// Desafios de autenticação em duas etapas em andamento (temporários)
model Mfa_Challenges {
  id          Int      @id @default(autoincrement())
  user_id     Int?
  admin_id    Int?
  token       String   @unique @db.Char(36) // UUID v4 do desafio
  code_hash   String   @db.VarChar(255)     // Hash Bcrypt do código de 6 dígitos
  tentativas  Int      @default(0)          // Bloqueia com tentativas >= 5
  expires_at  DateTime @db.DateTime(0)      // Validade: 10 minutos
  created_at  DateTime @default(now()) @db.DateTime(0)

  @@index([token])
  @@index([user_id, expires_at])
  @@map("mfa_challenges")
}

/// Dispositivos confiáveis (Token de 30 dias)
model User_Trusted_Devices {
  id          Int      @id @default(autoincrement())
  user_id     Int?
  admin_id    Int?
  device_hash String   @unique @db.Char(64) // SHA-256 do token opaco
  user_agent  String?  @db.VarChar(255)     // Ex: "Chrome 128 no Windows"
  ip_address  String?  @db.VarChar(45)
  expires_at  DateTime @db.DateTime(0)      // Validade: NOW() + 30 dias
  created_at  DateTime @default(now()) @db.DateTime(0)

  @@index([user_id, expires_at])
  @@map("user_trusted_devices")
}
```

---

## 4. Fluxo e Endpoints da API

### 4.1. `POST /sindico/login` e `POST /crm/login`
1. O backend valida `login` e `senha` com Bcrypt.
2. Verifica cabeçalho `x-device-token`.
   * Se o token existir e seu SHA-256 constar em `User_Trusted_Devices` com `expires_at > NOW()`:
     * Retorna o token JWT e a sessão completa imediatamente (bypass do 2FA).
   * Se não existir ou estiver expirado:
     * Gera código criptográfico de 6 dígitos (`crypto.randomInt(100000, 999999)`).
     * Salva o desafio em `Mfa_Challenges` com expiração de 10 min.
     * Envia e-mail formatado via `MailService`.
     * Retorna HTTP 200:
       ```json
       {
         "mfa_required": true,
         "mfa_token": "uuid-v4-do-desafio",
         "email_masked": "vi****@gmail.com",
         "expires_in_seconds": 600
       }
       ```

### 4.2. `POST /auth/mfa/verify`
* **Body:**
  ```json
  {
    "mfa_token": "uuid-v4-do-desafio",
    "code": "123456",
    "remember_device": true
  }
  ```
* **Lógica:**
  * Se desafio não existir ou `expires_at < NOW()`: erro `400 Código expirado ou inválido`.
  * Se `tentativas >= 5`: apaga o desafio e retorna `429 Muitas tentativas incorretas`.
  * Valida `bcrypt.compare(code, code_hash)`.
    * Se inválido: incrementa `tentativas` e retorna `401 Código incorreto. Restam X tentativas`.
    * Se válido:
      * Deleta o desafio em `Mfa_Challenges` (anti-replay).
      * Se `remember_device === true`: gera token aleatório de 64 hex, salva SHA-256 em `User_Trusted_Devices` (30 dias) e inclui na resposta.
      * Retorna o JWT de acesso final e os dados do usuário.

### 4.3. `POST /auth/mfa/resend`
* **Body:** `{ "mfa_token": "uuid-v4-do-desafio" }`
* Rate limit de 60 segundos entre reenvios. Gera novo código e renova os 10 minutos.

---

## 5. Interface Visual (UI/UX)

* **Componente Angular:** Transição fluida a partir do form de login quando `mfa_required === true`.
* **6 Caixas Numéricas:** Suporte a auto-focus sequencial, backspace e colar direto da área de transferência (Ctrl+V).
* **Checkbox:** *"Lembrar deste dispositivo por 30 dias"* (marcado por padrão).
* **Contador Regressivo:** *"Código válido por 09:59"*.
* **Reenvio:** Link com cooldown de 60 segundos.
