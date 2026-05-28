# 📷 Simulador de Terminal Facial — Guia de Uso

Página standalone que usa **sua webcam** para simular um terminal de reconhecimento facial físico (Control iD, Intelbras, ZKTeco). Útil para testar o fluxo completo da integração **antes de comprar o hardware real** (~R$ 1.800).

---

## ⚠️ Aviso importante

Este simulador é **apenas para testes locais e demonstração**. Não substitui um terminal facial profissional em produção:

- ❌ Não tem **liveness detection** (alguém pode burlar mostrando uma foto)
- ❌ Precisão menor (~95% vs ~99.9% do hardware profissional)
- ❌ Depende de a webcam estar ligada num PC ao lado da portaria
- ❌ Sem botão físico, sem relé pra catraca, sem infravermelho

Use-o para validar o fluxo `cadastro → reconhecimento → check-in → push notification` antes de investir no hardware.

---

## 🚀 Como usar

### Pré-requisitos
- Backend rodando (`npx nx serve api` em `click-cond-web/`)
- Pelo menos um **terminal facial cadastrado** no portal web (`/terminais-faciais`)
- Pelo menos um **morador ou visitante com foto** no condomínio
- PC com webcam (notebook serve)
- Chrome ou Edge (Firefox também funciona)

### Passo 1 — Pegar o token do webhook

1. Abra o portal web (`http://localhost:4200` ou produção)
2. Vá em **Terminais Faciais**
3. No card do terminal que você criou, clique em **"Copiar URL Webhook"**
4. A URL copiada tem este formato:
   ```
   http://localhost:4200/api/facial/webhook/<TOKEN-64-CHARS>
   ```
5. **Copie só o token** (a parte depois de `/webhook/`)

### Passo 2 — Abrir o simulador

Com o backend rodando, abra no navegador:

```
http://localhost:3000/simulator.html
```

> 🔒 **Por que tem que ser localhost?** O Chrome bloqueia acesso à webcam em páginas `file://`. Servindo pelo backend resolve isso.

### Passo 3 — Configurar

Na seção "Configuração" do simulador:

1. **URL do Backend**: já vem preenchido com `http://localhost:3000` (não mexa)
2. **Webhook Token**: cole o token que você copiou no Passo 1
3. Clique em **"Carregar Pessoas"**

Você deve ver:
- Status "Backend" ficar verde com o nome do terminal
- Lista de miniaturas (fotos dos moradores e visitantes) aparece no painel direito
- Log de eventos mostra `N pessoa(s) carregadas`

### Passo 4 — Ativar a webcam

1. Clique em **"Ativar Webcam"**
2. O Chrome vai pedir permissão — clique em **Permitir**
3. Seu rosto aparece no preview (em espelho, como num espelho real)
4. Box azul aparece em volta do seu rosto

### Passo 5 — Reconhecer alguém

Para o simulador reconhecer **você mesmo**, sua foto precisa estar cadastrada como morador ou visitante naquele condomínio. Duas opções:

**Opção A — Cadastrar você como morador:**
1. No portal web, vá em **Moradores**
2. **Novo Morador** → preencha seus dados
3. **Tire foto** com a webcam pelo próprio portal (botão da câmera no formulário)
4. Salvar
5. Volte ao simulador, clique em **"Carregar Pessoas"** de novo
6. Aponte a webcam para o seu rosto
7. Quando reconhecer, vai mostrar **"✓ Seu Nome (95%)"** em verde

**Opção B — Cadastrar a foto de outra pessoa qualquer:**
1. Cadastre um morador/visitante e suba uma foto qualquer (não tira pela webcam — faz upload)
2. Mostre essa foto **na tela de outro celular** para o simulador
3. Deve reconhecer

### Passo 6 — Ver o reconhecimento funcionando

Quando o simulador reconhecer alguém:

1. ✅ Mostra o nome em verde no preview
2. ✅ Destaca a foto da pessoa no grid (borda verde)
3. ✅ Chama o webhook do backend (`POST /api/facial/webhook/:token`)
4. ✅ Backend faz check-in automático (se for visitante)
5. ✅ Backend envia push notification para o morador
6. ✅ Aparece no **Log de Eventos** do simulador
7. ✅ Aparece também em **"Acessos Faciais"** no portal web

### Cooldown
O simulador tem um cooldown de **10 segundos por pessoa** — não dispara o webhook em loop se a pessoa ficar parada na frente da câmera.

---

## 🎚️ Ajuste de sensibilidade

O slider "Sensibilidade" controla a **distância máxima** para considerar match:

| Valor | Significado |
| --- | --- |
| **0.30** (esquerda) | Muito rigoroso — só reconhece se for muito igual à foto |
| **0.45** (padrão) | Bom equilíbrio |
| **0.70** (direita) | Permissivo — pode reconhecer pessoas erradas |

Recomendado: **0.45-0.50**. Se estiver tendo muitos falsos negativos, suba pra 0.55.

---

## 🔧 Como funciona por dentro

```
┌─────────────────────────────────────────────────────────┐
│  simulator.html (no Chrome)                             │
│                                                         │
│  1. Carrega modelos do face-api.js do CDN (~6 MB)      │
│  2. GET /api/facial/simulator/:token/persons           │
│     → recebe lista de moradores/visitantes + fotos      │
│  3. Calcula "embedding" (vetor) de cada foto            │
│  4. Captura webcam (640x480) a cada 600ms              │
│  5. Detecta rosto + calcula embedding em tempo real     │
│  6. Compara com os embeddings carregados                │
│  7. Se distância < threshold → MATCH!                   │
│  8. POST /api/facial/webhook/:token                     │
│     { external_id: "morador_42", confidence: 0.94 }    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Backend NestJS                                         │
│                                                         │
│  1. Valida token → identifica device                    │
│  2. Parse "morador_42" → busca morador no DB            │
│  3. Cria registro em Acessos_Facial                     │
│  4. Se visitante: faz check-in (data_entrada)           │
│  5. Envia push notification ao morador                  │
└─────────────────────────────────────────────────────────┘
```

---

## ❓ Problemas comuns

### "Modelos face-api: Erro"
- Sem internet, ou CDN fora do ar. Tenta refresh.
- Verifica console do navegador (F12) para erro específico.

### "Webcam: Negado"
- Você clicou em "Bloquear" quando o Chrome perguntou. Clique no cadeado da barra de endereços → Permissões → Câmera → Permitir.

### "Backend: Erro" ao carregar pessoas
- Token errado. Volte ao portal e copie a URL inteira do webhook, depois extraia só o token.
- Backend não está rodando. Inicie com `npx nx serve api`.

### Reconhecimento não acontece mesmo eu estando cadastrado
- Verifique se sua foto está sendo carregada (aparece na grid?)
- A foto deve ter **rosto frontal** e bem iluminado
- Suba a sensibilidade pra 0.55 ou 0.60
- Verifique no log se diz "N OK / M sem rosto detectável" — se sua foto está no "sem rosto detectável", refaça a foto

### "Desconhecido (dist 0.62)"
- Significa que detectou seu rosto mas não bateu com ninguém cadastrado
- Se você está cadastrado e mesmo assim aparece "desconhecido", suba o threshold ou refaça sua foto cadastrada

### Webhook retorna 401
- Token expirou ou device foi removido. Volte ao portal e gere novo terminal.

---

## 📌 Tip pro

Para testar com várias pessoas reais sem ter que cadastrar todo mundo:

1. Pegue uma foto sua em PNG/JPG
2. Cadastre como morador "Teste 1"
3. Pegue uma foto de outra pessoa (ou outra sua)
4. Cadastre como morador "Teste 2"
5. Simule: mostra a foto 1 → vê reconhecer como "Teste 1". Mostra foto 2 → reconhece como "Teste 2".

Útil pra ver o sistema diferenciar pessoas.

---

## 🔄 Quando migrar para terminal real

O simulador é descartável. Quando comprar o Control iD iDFace 373:

1. Cadastre o terminal real em `/terminais-faciais` com o IP físico
2. Pode **deixar o simulador rodando junto** durante a transição (ambos chamam o mesmo webhook)
3. Quando confirmar que o terminal físico está funcionando, pare o simulador
4. Pronto — o sistema não muda em mais nada
