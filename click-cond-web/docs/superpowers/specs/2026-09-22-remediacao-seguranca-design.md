# Remediação de Segurança — App, Portal, API e Dados

## Objetivo

Eliminar as vulnerabilidades confirmadas na API e no portal sem remover fluxos
legítimos de encomendas, portaria, facial ou gestão condominial. A entrega de
infraestrutura será um runbook; nenhuma alteração remota na AWS será feita por
esta implementação.

## Escopo

1. Impedir criação e leitura cross-tenant de encomendas.
2. Eliminar XSS na impressão de encomendas.
3. Retirar segredos versionados e impedir fallback inseguro.
4. Tornar uploads de dados sensíveis privados, validados e acessíveis por URL
   temporária.
5. Impedir SSRF nos fluxos faciais que consomem imagens remotas.
6. Adicionar cobertura automatizada de regressão.
7. Documentar a remediação operacional do RDS/AWS.

## Fora de escopo

- Rotacionar credenciais, alterar Security Groups, parameter groups ou o RDS.
- Migrar o token do portal de `localStorage` para cookies HttpOnly nesta entrega;
  isso exige uma alteração coordenada do contrato de autenticação e CORS.
- Remover índices redundantes sem uma janela operacional e confirmação contra o
  schema Prisma de produção.

## Arquitetura

### Encomendas

`EncomendasService.create` receberá o `JwtPayload` obrigatório e validará o
condomínio alvo com `TenantAccessService.assertCondominio` antes de consultar,
criar ou notificar. O controller da superfície mobile manterá o contrato
existente, mas não poderá escolher livremente outro condomínio.

A listagem do console exigirá `assertOperador`. A superfície do morador deve
continuar usando suas rotas próprias, limitadas ao apartamento vinculado, em
vez da listagem do console.

### Impressão

O portal substituirá concatenação HTML com valores externos por uma função pura
de escape HTML. Todos os campos vindos de encomenda serão escapados antes de
serem inseridos na janela de impressão.

### Storage

Uploads aceitarão apenas os MIME types explicitamente necessários (imagens
JPEG/PNG/WebP e PDF quando o fluxo permitir), com limites de bytes por tipo. O
objeto será privado; a API produzirá URLs pré-assinadas, de duração curta, só
depois de autorizar o tenant e a entidade solicitada. URLs públicas e data URLs
legadas continuarão sendo lidas temporariamente para compatibilidade, mas novos
uploads não serão públicos.

### Facial e SSRF

O facial aceitará data URLs e URLs pertencentes ao domínio de storage
configurado. URLs externas serão rejeitadas. A validação também bloqueará IPs
loopback, privados, link-local e hosts que resolvam para esses intervalos; não
seguirá redirecionamentos para hosts não permitidos.

### Segredos

Nenhuma senha ou token de integração terá fallback no fonte. O processo deverá
falhar claramente quando uma variável obrigatória não estiver configurada.

### AWS/RDS

Um runbook documentará: rotação dos segredos expostos, criação de usuário de
aplicação de menor privilégio, TLS obrigatório, `local_infile=0`, RDS privado,
Security Group mínimo e slow query log no CloudWatch. A execução é externa ao
repositório e requer janela de mudança.

## Segurança e compatibilidade

- A autorização é sempre aplicada no serviço, nunca apenas na UI ou controller.
- Erros de autorização devolvem 403 sem revelar registros de outro tenant.
- A migração de storage preserva a leitura de registros antigos; não reescreve
  fotos existentes nesta etapa.
- Credenciais expostas devem ser rotacionadas antes do deploy das correções.

## Testes de aceitação

1. Morador de outro condomínio não cria encomenda nem gera notificações.
2. Morador não acessa listagem global de encomendas do condomínio.
3. Conteúdo HTML em descrição/remetente é tratado como texto na impressão.
4. URL privada, loopback, link-local e host externo não permitido é recusada
   pelo fluxo facial; URL permitida e data URL válida continuam funcionando.
5. Upload não permitido ou acima do limite é recusado; upload válido não recebe
   ACL pública.
6. A inicialização da API falha se segredo obrigatório estiver ausente.

## Riscos e reversão

As alterações de autorização podem bloquear clientes que dependiam de rotas do
console indevidamente. A reversão é um rollback do release. O storage mantém
compatibilidade de leitura para dados antigos, reduzindo o risco de indisponibilidade.
