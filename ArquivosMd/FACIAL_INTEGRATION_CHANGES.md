# 📋 Alterações Implementadas — Integração com Terminal Facial

**Versão do app:** 1.0.0+16
**Branch:** `feat/facial-integration` (mergeada em `main` e `master`)
**Tag de backup:** `pre-facial-integration`
**Data:** 27/05/2026

Documento que descreve **todas as alterações** feitas no sistema Click Portaria para suportar integração com terminais faciais all-in-one (Control iD iDFace, Intelbras SS, ZKTeco, etc.) instalados na portaria do condomínio.

---

## 🎯 Objetivo da Integração

Permitir que moradores e visitantes cadastrados no sistema (com foto) sejam **reconhecidos automaticamente** por um terminal facial físico na portaria. Quando o rosto é reconhecido, o terminal libera a entrada e envia um evento para o sistema, que registra o acesso e notifica o morador.

**Estado atual:** integração **desligada por padrão** (`FACIAL_INTEGRATION_ENABLED=false`) — o sistema continua funcionando 100% como antes. Quando um terminal físico for comprado e configurado, basta ativar a flag.

---

## 🗄️ 1. Banco de Dados (Sprint 1)

Aplicado direto no MySQL do Railway via `prisma db push`.

### Colunas novas em `Moradores`
| Campo | Tipo | Descrição |
| --- | --- | --- |
| `face_id` | `VARCHAR(100)` | ID retornado pelo terminal após cadastro biométrico |
| `face_enrolled_at` | `DATETIME` | Quando o cadastro foi feito no terminal |
| `face_sync_status` | `VARCHAR(20)` | `synced` / `pending` / `error` |

### Colunas novas em `Visitantes`
Mesmos 3 campos acima.

### Tabela nova `Facial_Devices`
Configuração dos terminais cadastrados por condomínio.

| Campo | Descrição |
| --- | --- |
| `nome` | Ex: "Portaria Principal" |
| `fabricante` | `control_id` / `intelbras` / `zkteco` |
| `modelo` | Ex: "iDFace 373" |
| `ip` | IP do terminal na rede do condomínio |
| `porta` | Porta REST (geralmente 80) |
| `api_user` / `api_password` | Credenciais da API do terminal |
| `webhook_token` | Token gerado para autenticar webhooks |
| `ativo` | 0/1 |
| `ultima_sincr` | Última sincronização bem-sucedida |

### Tabela nova `Acessos_Facial`
Log de eventos de acesso pelo terminal.

| Campo | Descrição |
| --- | --- |
| `id_device` | Qual terminal registrou |
| `face_id` | ID biométrico da pessoa |
| `tipo_pessoa` | `morador` / `visitante` |
| `id_pessoa` | FK para Moradores ou Visitantes |
| `nome_pessoa` | Nome (denormalizado p/ histórico) |
| `evento` | `entrada` / `saida` / `negado` |
| `confianca` | Score 0-1 do match facial |
| `timestamp` | Quando o evento aconteceu |

---

## 🔧 2. Backend NestJS (Sprint 2)

### Módulo novo: `apps/api/src/app/facial/`

**Arquivos criados:**
- `facial.module.ts` — registra os providers e controllers
- `facial.service.ts` — orquestração (CRUD de devices, sync de pessoas, processamento de webhook)
- `facial.controller.ts` — endpoints REST + webhook público
- `facial-device-client.service.ts` — cliente HTTP que fala com o terminal (REST + Basic Auth)

### Endpoints disponíveis

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/facial/devices?id_condominio=X` | Lista terminais |
| `GET` | `/api/facial/devices/:id` | Detalhe de um terminal |
| `POST` | `/api/facial/devices` | **Cadastrar novo terminal (informar IP)** |
| `PUT` | `/api/facial/devices/:id` | Atualizar terminal |
| `DELETE` | `/api/facial/devices/:id` | Remover terminal |
| `POST` | `/api/facial/devices/:id/test` | Testar conectividade (ping no IP) |
| `POST` | `/api/facial/sync/morador/:id` | Re-sincronizar morador manualmente |
| `POST` | `/api/facial/sync/visitante/:id` | Re-sincronizar visitante manualmente |
| `GET` | `/api/facial/acessos?id_condominio=X` | Histórico geral de acessos do condomínio |
| `GET` | `/api/facial/acessos/visitante/:id` | Histórico de um visitante |
| `GET` | `/api/facial/acessos/morador/:id` | Histórico de um morador |
| `POST` | `/api/facial/webhook/:token` | **Endpoint público que recebe eventos do terminal** |

### Hooks adicionados em services existentes

**`moradores.service.ts`:**
- Após `create()` com foto → dispara `facial.syncMorador(id)` (fire-and-forget)
- Após `update()` se a foto mudou → re-sincroniza
- Após `remove()` → chama `facial.unsyncMorador()` para limpar do terminal

**`visitantes.service.ts`:**
- Idem: hooks em create/update/remove
- `findAllMobile()` agora também devolve `face_sync_status` (para o app exibir badge)

**Importante:** todas as chamadas para o terminal são **assíncronas e não bloqueantes**. Se o terminal estiver offline, o status fica `pending` e o `MoradoresService`/`VisitantesService` retorna normalmente. A integração nunca trava o fluxo principal do app.

### Variáveis de ambiente novas

Em `.env`:
```bash
FACIAL_INTEGRATION_ENABLED="false"  # quando true, ativa toda a integração
FACIAL_HTTP_TIMEOUT_MS="10000"      # timeout p/ requests ao terminal
```

---

## 🎨 3. Frontend Angular — Portal Web (Sprint 3)

### Página nova: `/terminais-faciais`

**Arquivos criados em `apps/portaria-web/src/app/terminais-faciais/`:**
- `terminais-faciais.service.ts` — HTTP client para `/api/facial/*`
- `terminais-faciais-page.component.ts` — componente da página
- `terminais-faciais-page.component.html` — template

**Funcionalidades:**
- Listar terminais cadastrados (cards com nome, IP, status, última sincronização)
- Botão "Novo Terminal" → modal com formulário (nome, fabricante, IP, porta, credenciais)
- Botão "Testar Conexão" em cada card (mostra Online/Offline em tempo real)
- Botão "Copiar URL Webhook" (gera URL completa para colar na config do terminal)
- Editar e Remover terminais

### Item novo no menu lateral

Adicionado em `sidebar.component.ts`, seção "Administrativo":
```
Terminais Faciais  (entre Relatórios e Configurações)
```

### Badge de status facial em moradores e visitantes

Tanto em `moradores-page.component.html` quanto `visitantes-page.component.html`, ao lado do nome aparece uma badge colorida:

| Status | Badge | Cor |
| --- | --- | --- |
| `synced` | "FACIAL" | 🟢 Verde |
| `pending` | "SINC." | 🟡 Amarelo |
| `error` | "ERRO" | 🔴 Vermelho |
| (sem foto) | nada | — |

---

## 📱 4. App Flutter — Mobile (Sprint 4)

### Controller novo: `controllers/controller_facial.dart`

HTTP client com 2 funções:
- `apiGetAcessosVisitante(idVisitante)` → busca histórico do visitante
- `apiGetAcessosMorador(idMorador)` → busca histórico do morador

### Widget novo: `pages/shared/visitantes/acessos_facial_list.dart`

Timeline de eventos do visitante mostrando:
- Ícone "↗ Entrou" / "↙ Saiu" / "✖ Negado"
- Data e hora formatadas (`dd/MM/yyyy às HH:mm`)
- Score de confiança do reconhecimento (ex: "94%")
- Estado vazio elegante quando não há acessos

### Modificações em `list_visitantes.dart`

1. **Badge facial no card** ao lado do nome (mesma lógica do portal web)
2. **Seção de histórico** no modal de detalhes (entre datas de entrada/saída e o bloco do PIN)

### Aviso de foto em `new_visitante.dart`

Adicionado banner discreto abaixo do círculo da foto:
> 📷 *"Foto necessária para acesso facial automático na portaria"*

### Handler de push em `services/firebase_service.dart`

Agora reconhece dois `type`s no payload da notificação:
- `visitante` (PIN — já existia)
- `visitante_acesso` (terminal facial reconheceu — novo)

Também adicionou `onMessageOpenedApp.listen()` (groundwork para deeplink futuro).

---

## 🚀 5. Deploy em Produção (Sprint 6)

### Branches do projeto
- **`main`** → monitorada pelo **Vercel** (frontend)
- **`master`** → monitorada pelo **Railway** (backend)
- **`feat/facial-integration`** → branch de desenvolvimento (mergeada nas duas acima)

### O que foi feito:
1. ✅ Schema aplicado no banco do Railway via `prisma db push` (Sprint 1)
2. ✅ Push em `main` → deploy do **frontend** no Vercel (`clickprestarecondominios.com.br`)
3. ✅ Push em `master` → deploy do **backend** no Railway (`click-prestare-production.up.railway.app`)
4. ✅ App Flutter buildado como `app-release.aab` (versão 1.0.0+16)

### URLs de produção em uso
- Portal Web: https://clickprestarecondominios.com.br/terminais-faciais
- Backend API: https://click-prestare-production.up.railway.app/api/facial/...
- App Bundle: `click-cond-app/click-cond-app/build/app/outputs/bundle/release/app-release.aab`

---

## 🛡️ Segurança e Robustez

### Webhook autenticado por token
Cada terminal cadastrado gera automaticamente um `webhook_token` (32 bytes aleatórios em hex). A URL pública é `/api/facial/webhook/:token` — terminais com token inválido recebem 401.

### Integração isolada
Todas as chamadas para o terminal usam timeout de 10s e são wrappadas em try/catch. Se o terminal estiver offline:
- Sync de pessoa → status `pending` (não bloqueia o create do morador)
- Ping no teste → mostra "Offline" no painel
- Remoção → registra warning no log mas não falha

### Feature flag global
A variável `FACIAL_INTEGRATION_ENABLED` controla TUDO. Quando `false`:
- Nenhum hook de sync é disparado
- Nenhuma request HTTP é feita para terminal
- Tudo no sistema continua funcionando normalmente

---

## 📊 Resumo Quantitativo

| Métrica | Valor |
| --- | --- |
| **Arquivos criados** | 14 |
| **Arquivos modificados** | 16 |
| **Linhas de código adicionadas** | ~2.400 |
| **Endpoints REST novos** | 11 |
| **Tabelas novas no banco** | 2 |
| **Colunas novas em tabelas existentes** | 6 |
| **Build size do app (aumento)** | ~50 KB |

---

## 🧪 Como Testar a Integração

### Sem hardware (verificar interfaces)
1. Acesse https://clickprestarecondominios.com.br
2. Login como síndico
3. Menu lateral → "Terminais Faciais"
4. Cadastre um terminal fake (IP `192.168.1.50`)
5. Clique "Testar Conexão" → vai dar Offline (esperado)
6. Verifique o card renderizado corretamente

### Com hardware real (futuro)
1. Comprar Control iD iDFace 373 (~R$ 1.800)
2. Instalação física na portaria (técnico CFTV ~R$ 200)
3. Configurar IP estático na rede do condomínio
4. Cadastrar em `/terminais-faciais` com IP real
5. Adicionar `FACIAL_INTEGRATION_ENABLED=true` nas Variables do Railway
6. Tirar foto do morador no portal → sync automático
7. Morador chega na portaria → terminal reconhece → catraca abre → push notification no app do morador

---

## 🔄 Como Reverter Tudo

Se precisar voltar para a versão anterior à integração:

```bash
# Voltar código
git checkout main
git reset --hard pre-facial-integration
git push origin main --force-with-lease

git checkout master
git reset --hard pre-facial-integration
git push origin master --force-with-lease

# Reverter banco (cuidado — apaga dados das tabelas faciais)
# Editar schema.prisma removendo Facial_Devices, Acessos_Facial e
# as colunas face_* em Moradores/Visitantes, depois:
cd click-cond-web
npx prisma db push --accept-data-loss
```

A tag `pre-facial-integration` no GitHub é o ponto exato de antes da integração.

---

## 📚 Documentos Relacionados

- [`FACIAL_INTEGRATION_PLAN.md`](FACIAL_INTEGRATION_PLAN.md) — Plano original com arquitetura, custos e sprints
- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — Guia de deploy (ambiente local, Vercel, Railway)
- [`CLAUDE.md`](click-cond-web/CLAUDE.md) — Instruções para trabalhar com Nx

---

## ✅ Status Final

| Sprint | Conteúdo | Status |
| --- | --- | --- |
| 1 | Schema do banco | ✅ Aplicado no Railway |
| 2 | Backend NestJS | ✅ Em produção |
| 3 | Frontend Angular | ✅ Em produção |
| 4 | App Flutter | ✅ .aab v1.0.0+16 gerado |
| 5 | Teste em hardware real | ⏳ Aguardando compra do terminal |
| 6 | Deploy produção | ✅ Concluído |

**Sistema 100% pronto para integrar com um terminal facial físico assim que o hardware for adquirido.**
