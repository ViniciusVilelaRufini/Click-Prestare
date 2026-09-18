# Especificação Técnica: Eliminação de MD5 e Blindagem de Hash com Bcrypt

**Data:** 18/09/2026  
**Status:** Aprovado  
**Objetivo:** Extinguir o uso de MD5 para armazenamento e verificação de senhas em todo o ecossistema (NestJS, Express, banco RDS), garantindo que 100% dos usuários novos e existentes migrem para Bcrypt com salt round 10/12 sem quebrar acessos nem exigir redefinição forçada de senhas.

---

## 1. Contexto e Vulnerabilidade Atual
* O banco de dados do sistema (`Users` e `Funcionarios_Portaria`) possui contas criadas em diferentes épocas.
* No backend legado Express (`click-cond-api`), novas contas ainda eram cadastradas executando `MD5('${password}')` via interpolação de strings no SQL.
* No backend NestJS (`click-cond-web`), embora o fluxo mobile já realizasse auto-migração para Bcrypt, o fluxo de login de Síndico na Web ([`auth.service.ts`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-web/apps/api/src/app/auth/auth.service.ts)) apenas comparava o MD5 legado, deixando a senha no banco como MD5 indefinidamente.
* Hashes MD5 sem sal são suscetíveis a ataques de força bruta e quebra imediata através de tabelas *rainbow*.

---

## 2. Requisitos Globais e Princípios de Design

1. **Zero Atrito (Just-in-Time Migration):**
   - Nenhum usuário deve ser bloqueado ou forçado a trocar de senha de imediato.
   - Ao fazer login com suas credenciais válidas:
     - Se o hash armazenado for Bcrypt (`$2a$`, `$2b$`, `$2y$`), valida normalmente.
     - Se o hash armazenado for MD5 (32 caracteres hexadecimais), valida contra o hash MD5 da senha digitada. Se bater, gera imediatamente `bcrypt.hash(senha, 10)` e atualiza o registro no banco antes de emitir a resposta de sucesso.
2. **Blindagem de Criação e Atualização:**
   - Nenhum endpoint, controller ou script pode gravar senhas em MD5.
   - Todas as gravações devem usar `bcrypt.hash(senha, 10)` ou `12`.
   - Todas as queries de banco no Express devem usar *prepared statements* parametrizados (`?`), eliminando riscos de SQL Injection.
3. **Auditoria e Observabilidade:**
   - Criar script utilitário para auditar o status dos hashes no AWS RDS MySQL (quantos `%` já estão em Bcrypt vs MD5).

---

## 3. Componentes e Arquitetura

### 3.1. NestJS (`click-cond-web/apps/api`)
* **[`apps/api/src/app/auth/auth.service.ts`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-web/apps/api/src/app/auth/auth.service.ts):**
  - No fallback de autenticação de síndico (`loginPortaria`), ao validar com sucesso uma senha MD5 (`sindicoMatch === true`), atualizar imediatamente `prisma.users.update` para gravar o novo hash gerado por `bcrypt.hash(senha, 10)`.
  - No método `changePassword` e redefinições, garantir que apenas Bcrypt seja gerado.

### 3.2. Express (`click-cond-api/click-cond-api`)
* **[`src/database/DB_Funcionarios.js`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-api/click-cond-api/src/database/DB_Funcionarios.js):**
  - Substituir queries literais `password=MD5(...)` por comparação com `bcrypt.compare` e gravação com `bcrypt.hash(password, 10)` com query parametrizada.
* **[`src/database/DB_Moradores.js`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-api/click-cond-api/src/database/DB_Moradores.js):**
  - Atualizar criação de moradores para usar Bcrypt e parâmetros `?`.
* **[`src/database/DB_Sindico.js`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-api/click-cond-api/src/database/DB_Sindico.js):**
  - Atualizar criação e atualização de senhas para Bcrypt e adicionar auto-migração Just-in-Time no login de síndico do Express.
* **[`src/database/DB_Users.js`](file:///c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-api/click-cond-api/src/database/DB_Users.js):**
  - Adicionar auto-migração Just-in-Time no login de usuários.

### 3.3. Scripts de Teste e Migração
* `prisma/seed.ts` e `prisma/stress_test.ts`: remover função `md5()` e usar `bcrypt.hashSync`.
* `scripts/migration/audit-password-hashes.mjs`: script autônomo para medir progresso da migração no RDS.

---

## 4. Plano de Testes
* `npx nx test api --testFile=senha-bcrypt.spec.ts`: garantir 0 ocorrências de geração de MD5 para senhas.
* Teste com `node --check` em todos os arquivos alterados do Express.
* Execução do script de auditoria no RDS para validar que a leitura de hashes opera sem falhas.
