# CRM WhatsApp — mídias e áudio

## Objetivo

Permitir que a equipe comercial envie imagens, vídeos e documentos a partir do CRM e consuma com segurança as mídias recebidas. Áudios recebidos devem tocar no próprio chat. O envio de texto, respostas rápidas, histórico e automações existentes não podem regredir.

## Escopo aprovado

- Envio manual de imagem, vídeo e documento em uma conversa com janela WhatsApp aberta.
- Exibição de imagem, vídeo, documento e áudio recebidos; áudio com controles de reprodução no chat.
- Persistência privada da mídia e de metadados suficientes para recuperar o conteúdo após a URL temporária da Meta expirar.
- Suporte a legenda opcional para imagem/vídeo/documento quando permitido pela API da Meta.

Não inclui gravação de áudio pelo navegador, stickers, localização, edição de mídias nem galeria pública.

## Arquitetura

### Fluxo de envio

1. O CRM mostra um botão de anexo ao lado do campo de mensagem. O usuário escolhe uma mídia, vê nome/tamanho e uma prévia quando aplicável, e confirma o envio.
2. `POST /crm/whatsapp/conversas/:id/midias` recebe multipart autenticado. A API valida conversa, janela de atendimento, tipo MIME permitido e tamanho.
3. A API envia o binário para a Graph API da Meta, recebe o identificador de mídia e envia a mensagem do tipo correspondente para o `wa_id` da conversa.
4. O CRM registra uma mensagem de saída com status, tipo, legenda, nome, MIME, tamanho e referência de mídia. Falhas geram uma mensagem com status `falhou`, sem apagar o arquivo nem o rascunho exibido ao operador.

### Fluxo de recebimento

1. O webhook passa a preservar tipo e identificador de mídia recebidos, em vez de gravar apenas o texto `[áudio recebido]`.
2. A API busca a URL temporária da mídia na Meta, baixa o binário imediatamente e armazena-o em bucket S3 privado com chave não adivinhável.
3. A mensagem recebida é salva com os metadados e a chave do objeto. Se a importação falhar, a mensagem permanece no histórico com estado de mídia indisponível e tentativa segura posterior; o webhook continua respondendo 200.

### Acesso e interface

- `GET /crm/whatsapp/midias/:mensagemId` é protegido pelo mesmo `CrmAdminGuard`, confere que há mídia e entrega o arquivo com MIME seguro e suporte a `Range`.
- O CRM renderiza: miniatura para imagem; player nativo para áudio; player/preview para vídeo; cartão com ícone, nome e download para documento.
- Nenhuma URL do bucket, token da Meta, ou dado de acesso aparece no HTML ou no banco como URL pública.

## Modelo de dados

A tabela `crm_whatsapp_mensagens` ganha campos nulos para `media_chave`, `media_mime`, `media_nome`, `media_tamanho` e `media_status`. A chave aponta somente para armazenamento privado. A migração SQL manual será permitida no workflow de banco antes do deploy da API.

## Validação e limites

- Tipos permitidos: imagens, vídeos, áudios e documentos aceitos pela Cloud API; a lista MIME será explícita e centralizada.
- Limites serão configuráveis por categoria, seguindo o limite vigente da Cloud API; a API rejeita arquivos fora da lista/limite antes de transferi-los.
- Nome de arquivo é normalizado para exibição e nunca usado como caminho de armazenamento.

## Erros e observabilidade

- O CRM mostra erro acionável por anexo, permite tentar novamente e não bloqueia o envio de texto.
- Falhas da Graph API/S3 são registradas com ID da mensagem, sem token, URL assinada ou conteúdo do arquivo em log.
- Recebimento permanece idempotente pelo `wamid`; uma repetição não gera outro arquivo ou mensagem.

## Testes de aceitação

1. Imagem, vídeo e documento válidos são enviados e registrados com o tipo correto.
2. Arquivo inválido ou grande demais é rejeitado antes de alcançar a Meta.
3. Webhook de áudio gera mídia privada e o CRM mostra um player que carrega a URL protegida.
4. Documento/imagem/vídeo recebidos aparecem com o componente correto e podem ser abertos pelo usuário autenticado.
5. Texto, respostas rápidas e a automação atual continuam funcionando.
6. A rota de mídia rejeita usuário não autenticado e uma mensagem sem mídia.
