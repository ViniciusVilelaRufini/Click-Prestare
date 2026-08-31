# PRESTARE IA — Upload de Faturas, Leitura Multimodal RAG e Integração Financeira

Data: 31/08/2026

## 1. Problema e Objetivo

Atualmente, o morador que recebe uma fatura (ex: conta de energia/luz, água, internet, gás, aluguel) precisa digitar manualmente cada valor, data de vencimento e linha digitável para organizar suas finanças no aplicativo. 

O objetivo desta funcionalidade é permitir que o morador simplesmente **tire uma foto ou envie um arquivo/PDF da fatura diretamente no chat do PRESTARE IA**. O assistente:
1. Recebe a imagem ou documento multimodal.
2. Analisa o documento com visão computacional e OCR inteligente via Gemini Multimodal.
3. Aplica **RAG contextualizado** (dados do morador, bloco, apartamento, histórico de faturas e categorias cadastradas).
4. Extrai os dados estruturados: Categoria (*Luz, Água, Internet, Aluguel, Gás, Outros*), Fornecedor/Concessionária (*ex: Enel, CPFL, Sabesp, Claro*), Valor, Vencimento, Código de Barras / Linha Digitável e Chave PIX Copia e Cola.
5. Apresenta uma resposta acolhedora e personalizada com um card de confirmação instantânea (`propor_conta_morador`).
6. Ao confirmar, cadastra a despesa pessoal no módulo Financeiro com status pendente para que o morador possa acompanhar e realizar o pagamento posteriormente.

---

## 2. Arquitetura e Fluxo de Dados

```
[ Usuário tira foto / seleciona PDF no Chat IA ]
                   │
                   ▼
[ Preview do Anexo acima do campo de entrada no App Flutter ]
                   │
                   ▼ (POST /chat-ia/perguntar com multipart/JSON base64)
[ NestJS API: ChatIaController -> ChatIaService ]
                   │
                   ├──► RAG Context: Morador, Apartamento, Histórico Financeiro
                   ├──► Gemini 3.6 Flash Multimodal (inlineData: image/jpeg ou application/pdf)
                   │
                   ▼
[ Gemini analisa a fatura e invoca ferramenta `propor_conta_morador` ]
                   │
                   ▼
[ Chat IA exibe resposta + Card de Ação "Confirmar lançamento" ]
                   │
                   ▼ (POST /chat-ia/confirmar)
[ FinanceiroService.insertMoradorConta ]
                   │
                   ▼
[ Conta salva na tabela `financeiro` (id_usuario = morador, status = 0/pendente) ]
                   │
                   ▼
[ Disponível na aba Financeiro do Morador com valor, vencimento e código de barras/PIX ]
```

---

## 3. Escopo Técnico

### Frontend (Flutter - `click-cond-app`)
- **Botão de Anexo:** Adicionado à esquerda do campo de texto no `chat_ia_page.dart` (ícone `PhosphorIcons.paperclip` ou `PhosphorIcons.cameraPlus`).
- **Menu de Seleção:** Opções para Câmera (`image_picker`), Galeria de Fotos (`image_picker`) ou Arquivo/PDF (`file_picker`).
- **Card de Prévia do Anexo:** Banner flutuante acima do campo de texto com thumbnail da imagem/ícone PDF, nome do arquivo, tamanho e botão `(X)` para remover antes de enviar.
- **Envio Multimodal:** `apiPerguntarChatIa` passa a aceitar parâmetro opcional `arquivo: { nome, mime_type, base64 }`.
- **Renderização da Bolha:** A bolha do usuário exibe a miniatura da foto/arquivo anexado junto ao texto enviado.

### Backend (NestJS - `click-cond-web`)
- **Endpoint `POST /chat-ia/perguntar`:** DTO aceita `arquivo?: { nome?: string; mime_type: string; base64: string }`.
- **Gemini Client:** `rodarLacoDeFerramentas` e `ConteudoGemini` passam a suportar partes multimodais (`inlineData: { mimeType, data }`).
- **Prompt do Sistema e RAG:** Instrução refinada instruindo o assistente a extrair faturas/boletos anexados, identificar a concessionária, categoria, vencimento, valor e código de barras/PIX, invocando `propor_conta_morador` com esses dados.
- **Ação `propor_conta_morador`:** Já existente, agora alimentada com os dados extraídos pelo Gemini e persistindo no `financeiro`.

---

## 4. Testes e Validação
- Testes unitários no backend para o DTO e payload multimodal do `ChatIaService`.
- Testes de widget no Flutter para o botão de anexo, preview de arquivo e renderização no `chat_ia_page.dart`.
- Validação no emulador Android com upload de fatura e checagem da persistência no Financeiro.
