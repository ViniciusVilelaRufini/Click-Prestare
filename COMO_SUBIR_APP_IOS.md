# Como o app iOS sobe para a App Store

Este projeto publica o app iOS **sem nenhum Mac**. Todo o build acontece num
runner macOS do GitHub Actions; a máquina de desenvolvimento é Windows e nunca
vê um Xcode. Isso explica quase todas as decisões deste documento.

---

## 1. A conexão com o GitHub

Não há integração especial: usa-se o **GitHub CLI (`gh`)** já autenticado nesta
máquina, com a conta `ViniciusVilelaRufini`.

```bash
gh auth status
# github.com
#   ✓ Logged in to github.com account ViniciusVilelaRufini (keyring)
#   - Token scopes: 'gist', 'read:org', 'repo'
```

O escopo **`repo`** é o que permite disparar workflows. Um *personal access
token* (PAT) comum **não** serve: a API responde
`403 Resource not accessible by personal access token` ao tentar
`workflow_dispatch`. Se precisar de um PAT para isso, ele tem que ter permissão
de **Actions: write**.

O repositório é `ViniciusVilelaRufini/Click-Prestare`, branch `master`.

> **Atenção ao nome antigo.** O perfil do GitHub já foi renomeado uma vez. O
> `git push` continua funcionando por redirecionamento, mas **integrações não
> seguem redirecionamento** — foi assim que o deploy do Railway ficou parado por
> horas sem ninguém perceber. Se o remote ainda apontar para o nome antigo:
>
> ```bash
> git remote set-url origin https://github.com/ViniciusVilelaRufini/Click-Prestare.git
> ```

---

## 2. O fluxo completo

```
código → commit → push (master) → gh workflow run → runner macOS → TestFlight
```

### Passo a passo

```bash
# 1. Tudo commitado e enviado
git status --short          # precisa estar vazio
git push origin master

# 2. O CI valida antes (roda sozinho no push)
gh run list --repo ViniciusVilelaRufini/Click-Prestare \
            --workflow ci.yml --branch master --limit 1

# 3. Dispara o build do iOS (MANUAL — não roda sozinho no push)
gh workflow run ios-release.yml \
   --repo ViniciusVilelaRufini/Click-Prestare \
   --ref master \
   -f destino=testflight

# 4. Acompanha
gh run list --repo ViniciusVilelaRufini/Click-Prestare \
            --workflow ios-release.yml --limit 1
gh run view <ID> --repo ViniciusVilelaRufini/Click-Prestare
```

O parâmetro `destino` aceita:

| Valor | Lane do fastlane | O que faz |
|---|---|---|
| `testflight` | `beta` | Sobe para o TestFlight (uso do dia a dia) |
| `app-store` | `release` | Sobe para a App Store, **sem** submeter para revisão |

**O disparo é manual de propósito.** Cada execução consome minutos de runner
macOS (que contam 10× no plano do GitHub) e gera um build number novo no
TestFlight. Publicar a cada commit queimaria os dois à toa.

> Na prática, `destino=app-store` raramente é necessário: **qualquer** binário
> enviado — inclusive pela lane do TestFlight — fica disponível para ser
> selecionado na versão da App Store, no painel.

---

## 3. O que o workflow faz (`.github/workflows/ios-release.yml`)

| # | Passo | Por que existe |
|---|---|---|
| 1 | `checkout` | — |
| 2 | **Selecionar Xcode 26+** | A Apple recusa binário com SDK anterior ao do iOS 26. A imagem `macos-15` traz vários Xcode 26.x, mas o **padrão dela ainda é o 16.4** |
| 3 | Flutter (versão fixa) | Mesma versão do CI, para não publicar binário de um Flutter que nunca passou pelo analyze |
| 4 | `flutter pub get` | — |
| 5 | Ruby + CocoaPods | `pod install --repo-update` |
| 6 | **Build do Flutter** | `--release --no-codesign`; quem assina é o gym, depois |
| 7 | **Assinar e enviar** | fastlane: `match` busca certificado e perfil, `gym` arquiva, `pilot` envia |
| 8 | Guardar artefatos | `.ipa` e `.dSYM` ficam anexados à execução |

### Assinatura: por que `match`

Assinatura automática exige o Xcode conversando com uma conta logada na
interface — algo que não existe em CI. Por isso a assinatura é **manual**, e
quem entrega certificado e perfil é o `match`, que os guarda criptografados num
repositório à parte.

A autenticação com a Apple usa **chave da App Store Connect API** (`.p8`), não
senha de Apple ID — chave não tem 2FA para atrapalhar um job sem interação.

### Segredos necessários (Settings → Secrets → Actions)

| Secret | Para que serve |
|---|---|
| `ASC_KEY_ID` | Chave da App Store Connect API |
| `ASC_ISSUER_ID` | idem |
| `ASC_KEY_P8_BASE64` | o `.p8` em **base64** (um `.p8` tem quebras de linha, e secret multi-linha é fonte de erro silencioso) |
| `MATCH_GIT_URL` | repositório dos certificados |
| `MATCH_PASSWORD` | senha que descriptografa esse repositório |
| `MATCH_GIT_BASIC_AUTHORIZATION` | acesso ao repositório de certificados |

---

## 4. Versão e build number

São coisas diferentes, e só uma vem do `pubspec.yaml`:

| | De onde vem | Exemplo |
|---|---|---|
| **Versão** (`CFBundleShortVersionString`) | `version:` do `pubspec.yaml` | `1.0.0` |
| **Build number** (`CFBundleVersion`) | **data/hora UTC** gerada no workflow | `2608131425` |

O `+47` do `pubspec.yaml` vale para o **Android**. No iOS ele é ignorado: o
workflow sobrescreve com `AAMMDDhhmm`.

**Por que timestamp e não um contador:** a Apple exige que o build number seja
maior que o de qualquer envio anterior da mesma versão. O `github.run_number`
que havia antes só conhece as execuções deste workflow — builds enviados por
fora (Xcode Cloud, envio manual) o deixavam para trás. O relógio nunca anda para
trás entre dois builds.

> Para isso funcionar, o `Info.plist` **precisa** ler
> `CFBundleVersion = $(FLUTTER_BUILD_NUMBER)`. Se estiver
> `$(CURRENT_PROJECT_VERSION)`, o valor do projeto Xcode vence e o
> `--build-number` é ignorado **em silêncio**.

---

## 5. Depois que o build sobe

1. **Processamento** no App Store Connect: de minutos a ~1h
2. **Teste interno** não passa por revisão — o build fica disponível assim que
   processa. Testers internos precisam ser usuários da conta em
   *Utilizadores e acesso*
3. **Teste externo** passa pela Beta App Review (horas a ~1 dia)
4. Para **publicar**: prepare a versão no painel, selecione o build e submeta

---

## 6. Erros já enfrentados e o que significam

Guardados aqui porque todos custaram um build inteiro para descobrir.

| Mensagem | Causa real | Correção |
|---|---|---|
| `No profile for team 'XXXX' matching...` (exit 65) | Team ID fixo no Fastfile diferente do time da chave da API | O Fastfile deriva o time de `sigh_<app>_appstore_team-id`, publicado pelo `match` |
| `SDK version issue... built with the iOS 18.5 SDK` (409) | Runner usou o Xcode padrão (16.4) | Passo "Selecionar Xcode 26+" |
| `bundle version must be higher than the previously uploaded version` | Build number repetido ou menor | Timestamp **e** `CFBundleVersion = $(FLUTTER_BUILD_NUMBER)` |
| `403 Resource not accessible by personal access token` | PAT sem permissão de Actions | Use o `gh` autenticado, ou um PAT com **Actions: write** |
| Deploy do backend parado sem erro | Repositório renomeado; webhook aponta para o nome antigo | Reconectar a origem no Railway/Vercel |
| App abre e trava na splash | `GoogleService-Info.plist` fora do target Runner | O arquivo precisa estar no `project.pbxproj` (referência + fase de Resources) |

---

## 7. Dados fixos do projeto

| | |
|---|---|
| Bundle ID | `br.com.clickprestare.app` |
| Team ID (Apple) | `9FD7V97G5V` |
| Projeto Firebase | `click-prestare` |
| Deployment target | iOS 16.0 |
| Runner | `macos-15` |

> **Cuidado com o `com.thefixt.click`.** Ele existe no mesmo projeto Firebase e
> não tem relação com este app. Já causou um problema difícil: o
> `GoogleService-Info.plist` do projeto era daquele app com o bundle editado à
> mão, e por isso o push nunca funcionou no iOS. Ao mexer em Cloud Messaging,
> confirme que o app selecionado é o `br.com.clickprestare.app`.
