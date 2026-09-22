# Uploads privados

## Contrato novo

Novos uploads retornam e persistem somente a chave opaca do objeto (por exemplo,
`moradores/1700000000000-uuid.jpg`). Eles não retornam `R2_PUBLIC_URL`, URL do
bucket, nem ACL pública. Clientes não devem usar uma chave nova diretamente em
`src` ou como link de download.

Uma leitura de chave privada passa pela rota autenticada `GET /storage/read`
com `key` e `id_condominio`. Antes de consultar o bucket, ela:

1. valida que `key` é uma chave opaca segura (não uma URL);
2. confirma o vínculo do solicitante com o condomínio por
   `TenantAccessService.assertCondominio`;
3. faz streaming do conteúdo privado, sem expor URL do bucket.

O `id_condominio` informado pelo cliente é apenas o recurso a autorizar; ele
nunca é confiado sem a validação do vínculo autenticado. Para dados com regra
mais restrita que o condomínio, o endpoint da própria entidade deve fazer a
validação adicional antes de delegar a leitura.

## Compatibilidade de migração

Registros existentes que tenham URL pública continuam sendo identificados por
`StorageService.isTrustedPublicUrl` somente quando host e caminho coincidirem
com a configuração legada. Eles podem ser lidos até a migração da entidade para
uma chave privada. URLs de outros hosts não são consideradas referências de
storage confiáveis.

Os consumidores que gravam o retorno de `uploadDataUrl` ou de `saveToAWS`
devem tratá-lo como chave opaca e lê-lo pela rota privada. No legado, somente
o fluxo explícito de edição pode reenviar URL/chave já persistida; um novo
upload não-data-URL é rejeitado. O fluxo de PUT pré-assinado foi desabilitado
porque não permitia validar MIME, tamanho e assinatura no servidor.
