# Aceite de privacidade (LGPD) no app — design

Tela de consentimento bloqueante após o login do morador e do síndico, com o
aceite registrado no servidor por versão da política.

Status: desenho aprovado, não implementado.
**Este documento é para revisão jurídica.** As seções 2, 6 e 8 são as que
precisam do olhar da advogada.

Repositório: `c:\Users\vinic\Desktop\Click-with-Prestare`

---

## 1. Problema

O app coleta CPF, foto e **biometria facial** — dado sensível pelo Art. 11 da
LGPD — e hoje nunca pede consentimento. Existe uma política de privacidade
publicada, alcançável por um item em Configurações que quase ninguém abre.
Ninguém declara ter lido nada, e não há registro de quem concordou com o quê.

Isso é risco jurídico, não estético: sem consentimento registrado, não há base
legal demonstrável para o tratamento de biometria, e não há como responder
"quando esta pessoa consentiu, e com qual texto".

## 2. O que a LGPD exige do consentimento (e este desenho entrega)

Art. 8º, §1º — consentimento por escrito ou outro meio que demonstre a
manifestação de vontade. **Entrega:** registro em banco com data, versão do
texto e identificação do titular.

Art. 8º, §4º — consentimento referente a finalidades determinadas;
autorizações genéricas são nulas. **Entrega:** o texto lista as finalidades
uma a uma (autenticação, controle de acesso, comunicação do condomínio).

Art. 9º — o titular tem direito a informação clara sobre finalidade, forma e
duração do tratamento, identificação do controlador, uso compartilhado e
responsabilidades. **Entrega:** resumo na própria tela, com link para a
política completa.

Art. 11, II — dado sensível (biometria) exige consentimento **específico e
destacado**. **Entrega:** caixa separada, com texto próprio, independente do
aceite geral.

Art. 8º, §3º — o consentimento deve ser **livre**. **Entrega:** a caixa da
biometria é opcional; recusá-la não impede o uso do app. Ver §4.4 — a recusa
tem efeito real no sistema.

Art. 8º, §5º — o consentimento pode ser revogado. **Entrega:** a tabela é
append-only e a revogação é um registro novo, não a edição do anterior. A tela
de revogação fica para uma segunda etapa (§7).

Art. 18 — direitos do titular (acesso, correção, eliminação, portabilidade).
**Entrega:** a tela remete à política e ao canal do Encarregado. **Ver §8: hoje
esse canal não existe.**

## 3. Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Bloqueia o app? | **Sim**, tela cheia após o login | Consentimento que dá para pular não é consentimento |
| Recusa do aceite geral | Desloga, com caminho de exclusão de conta visível | Sem base legal, não há tratamento |
| Onde registra | **Servidor**, tabela própria | É prova; precisa sobreviver a reinstalação e troca de aparelho |
| Mudança de texto | Pede aceite de novo, **por versão** | Aceite de um texto não vale para outro |
| Biometria | **Caixa separada e opcional** | Art. 11, II (destacado) e Art. 8º, §3º (livre) |

## 4. Arquitetura

### 4.1 Dados

Tabela nova `Consentimentos`, **append-only**:

| Campo | Para quê |
|---|---|
| `id` | PK |
| `id_user` | titular |
| `tipo` | `privacidade` \| `biometria` |
| `versao` | versão do texto vigente no momento do aceite |
| `aceito` | `1` aceitou, `0` recusou — a recusa também é fato a registrar |
| `registrado_em` | quando |

Append-only, e não colunas em `Users`, porque o que se precisa provar é o
**histórico**: o que a pessoa aceitou, em que versão, quando, e se depois
revogou. Sobrescrever um campo apaga exatamente a informação que dá
sustentação jurídica ao tratamento.

O estado atual é a linha mais recente por `(id_user, tipo)`. Índice em
`(id_user, tipo, registrado_em)`.

### 4.2 Versão da política

Constante no servidor (`POLITICA_VERSAO`). Mudou o texto, muda a constante, e
quem aceitou versão anterior vê a tela de novo. Sem isso, "aceitei" vira uma
afirmação sobre um texto que ninguém sabe mais qual era.

### 4.3 API

- `GET /consentimentos/pendentes` — devolve o que falta aceitar e a versão
  vigente.
- `POST /consentimentos` — grava `{ privacidade: boolean, biometria: boolean }`
  como duas linhas.

### 4.4 A trava do facial — a parte que faz a caixa valer

`fireFacialSync` (em `visitantes.service.ts`) passa a consultar o último
consentimento de biometria do titular antes de enrolar. Sem aceite, não
enrola.

Isto não é acessório: **uma caixa de consentimento que o sistema ignora é pior
que caixa nenhuma**, porque produz aparência de conformidade sem a substância.
Hoje o `create()` dispara o sync sem consultar consentimento algum — defeito
já identificado em revisão de código no módulo de convites.

Consequência assumida: morador que recusar a biometria não abre a portaria
pelo rosto e usa os outros meios (PIN, interfone). Isso é o desenho
funcionando, não uma limitação.

### 4.5 App

Tela cheia, sem botão de fechar, mostrada em **dois** pontos:

1. depois do login;
2. no bootstrap, para quem entra por auto-login — senão quem já está logado
   nunca veria a tela.

Conteúdo: resumo dos pontos do Art. 9, link para a política completa, duas
caixas (privacidade obrigatória, biometria opcional), "Aceitar e continuar",
"Recusar e sair" e o caminho de exclusão de conta.

## 5. Testes

- Sem consentimento registrado → `pendentes` acusa.
- Aceite na versão anterior → acusa de novo quando a constante muda.
- Aceitar grava duas linhas; recusar a biometria grava `aceito = 0`.
- `fireFacialSync` não enrola sem consentimento de biometria.
- Aceite de um usuário não vale para outro.
- Revogar depois de aceitar não apaga o registro anterior.

## 6. Texto da tela — RASCUNHO, pendente de revisão jurídica

> **Sua privacidade**
>
> Para usar o Prestare Portaria, precisamos do seu consentimento para tratar
> alguns dados pessoais.
>
> **O que tratamos e para quê**
> Nome, e-mail, telefone, CPF e sua unidade — para identificar você, controlar
> o acesso ao condomínio e enviar comunicados oficiais.
>
> **Com quem compartilhamos**
> Com a administração do seu condomínio. Não vendemos seus dados nem os usamos
> para publicidade.
>
> **Por quanto tempo**
> Enquanto você for morador, e pelo prazo legal aplicável depois disso.
>
> **Seus direitos**
> Você pode pedir acesso, correção ou exclusão dos seus dados a qualquer
> momento, e revogar este consentimento. [canal do Encarregado — ver §8]
>
> ☐ Li e concordo com a Política de Privacidade e com o tratamento dos meus
> dados pessoais descrito acima. *(obrigatório)*
>
> ☐ Autorizo o uso da minha **biometria facial** para abrir a portaria pelo
> reconhecimento do rosto. Este é um dado sensível, o consentimento é
> específico, e você pode recusar sem perder o acesso ao aplicativo —
> continuará entrando por PIN ou interfone. *(opcional)*

## 7. Fora desta entrega

- **Tela de revogação** do consentimento nas Configurações. A tabela já
  suporta (append-only); falta a interface.
- **Aceite para porteiro/funcionário.** Só morador e síndico, como pedido.
- **Retroatividade.** A versão do app já publicada (1.2.10) não conhece a
  tela e continuará funcionando sem aceite. Não há como forçar cliente antigo
  sem quebrá-lo; o aceite passa a valer conforme as pessoas atualizarem.

## 8. Bloqueios para a advogada

Estes três pontos impedem que a tela seja honesta, e nenhum se resolve com
código:

1. **O Encarregado (DPO) não existe na prática.** A política diz "contate
   nosso Encarregado de Dados através do canal oficial citado acima" — e **não
   há canal citado em lugar nenhum**: nem nome, nem e-mail, nem telefone. O
   Art. 41 exige que o controlador indique o encarregado e divulgue a
   identidade e as informações de contato. Sem isso, a tela pede consentimento
   e não diz como exercer os direitos.

2. **O nome do produto na política está desatualizado.** O texto fala em
   "Click Condomínios / Click Portaria"; o produto passou a se chamar
   **Prestare Portaria**. Consentimento que nomeia um produto diferente do que
   está na tela é convite a questionamento.

3. **Quem é o controlador e quem é o operador.** A política trata "o
   condomínio" e "a operadora da plataforma" de forma intercambiável. Na LGPD
   isso muda quem responde pelo quê: o condomínio provavelmente é controlador
   e a Prestare, operadora — e o texto do aceite deve refletir a divisão. É a
   mesma questão do DPA do Railway que já está com ela.

## Ver também

- Nota do vault: `LGPD e Dados Biometricos`
- Nota do vault: `Exclusao de Conta e Compliance Play Store`
- `apps/portaria-web/src/app/legal/politica-privacidade.component.ts` — a
  política vigente, base do texto acima
- `comercial/DPA_RAILWAY_PARA_ADVOGADA.md`
