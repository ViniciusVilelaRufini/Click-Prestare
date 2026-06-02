# Como gerar o `.aab` para a Play Store (Click Prestare)

Guia para gerar o Android App Bundle (`.aab`) de release sem errar. Leia **antes**
de cada build de loja.

> App: `br.com.clickprestare.app` — backend produção no Railway, web na Vercel.

---

## ⚠️ Checklist crítico (NÃO PULAR)

Antes de gerar o `.aab`:

1. **API em produção** — em [lib/utils/api_config.dart](lib/utils/api_config.dart):
   ```dart
   static const bool isProduction = true;   // <-- TEM que estar true p/ a loja
   ```
   Se ficar `false`, o app publicado aponta para `10.0.2.2:3003` (PC local) e
   **não acessa backend nenhum**. Em produção o host vira
   `click-prestare-production.up.railway.app` (HTTPS).

2. **Versão** — incrementar SEMPRE o `versionCode` (a Play Store recusa um
   versionCode já enviado). Dois lugares devem bater:
   - `android/local.properties` (é o que o Gradle realmente lê — **gitignored**):
     ```
     flutter.versionName=1.0.X
     flutter.versionCode=X
     ```
   - `pubspec.yaml` (consistência / versionado no git):
     ```
     version: 1.0.X+X
     ```
   Convenção atual: versionName `1.0.X` e versionCode `X` (ex.: `1.0.26+26`).

3. **Keystore de upload** presente (NÃO commitar):
   - Arquivo: `android/app/upload-keystore.jks` (alias `upload`).
   - Credenciais ficam em `android/local.properties`
     (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`).
   - `android/local.properties` está **gitignored** de propósito (tem senhas).
     **Nunca** commitar esse arquivo nem a `.jks`.

---

## Passo a passo

```bash
# 1. (manual) Editar api_config.dart -> isProduction = true
# 2. (manual) Bump de versão em local.properties E pubspec.yaml
# 3. Build do bundle (NÃO rodar "flutter clean" sem necessidade):
flutter build appbundle --release
```

Saída:
```
build/app/outputs/bundle/release/app-release.aab
```
Subir esse arquivo no **Google Play Console**.

> O build alterna `flutter.buildMode` para `release` em `local.properties`
> automaticamente — normal.

---

## ⚠️ Depois do build (IMPORTANTE)

**Reverter `isProduction` para `false`** em `api_config.dart` para continuar
desenvolvendo/testando contra o backend local (emulador `10.0.2.2:3003`):
```dart
static const bool isProduction = false;
```
O `.aab` já gerado **não muda** — ele foi compilado com `true` e é o que vai
para a loja. A reversão só afeta builds locais futuros.

---

## O que commitar (e o que NÃO commitar)

- ✅ Commitar: `pubspec.yaml` (bump de versão).
- ✅ Deixar `api_config.dart` em `false` no repositório (estado de dev).
- ❌ NÃO commitar: `android/local.properties` (senhas + keystore) — gitignored.
- ❌ NÃO commitar: `*.jks`, o `.aab` gerado.

Deploy do backend/web continua via push:
- `master` → Railway (backend)
- `main` → Vercel (web)
(empurrar nas duas: `git push origin master` e `git push origin master:main`).

---

## Verificações úteis (opcional)

```bash
# Conferir que o .aab existe e o tamanho
ls -la build/app/outputs/bundle/release/app-release.aab

# Conferir que está assinado (deve aparecer UPLOAD.RSA / UPLOAD.SF)
unzip -l build/app/outputs/bundle/release/app-release.aab | grep META-INF

# Conferir o versionName embutido (manifest é protobuf; busca textual)
unzip -o -q build/app/outputs/bundle/release/app-release.aab \
  base/manifest/AndroidManifest.xml -d /tmp/aab && \
  grep -a "1.0.X" /tmp/aab/base/manifest/AndroidManifest.xml
```

---

## Histórico

- **v1.0.26 (versionCode 26)** — primeiro `.aab` documentado por este guia.
  Build com `isProduction=true`; revertido para `false` após o build; bump de
  versão commitado (`ccbdd70`).
