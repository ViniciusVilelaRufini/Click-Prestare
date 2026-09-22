# Uploads privados

## Contrato novo

Novos uploads retornam e persistem somente a chave opaca do objeto (por exemplo,
`moradores/1700000000000-uuid.jpg`). Eles não retornam `R2_PUBLIC_URL`, URL do
bucket, nem ACL pública. Clientes não devem usar uma chave nova diretamente em
`src` ou como link de download.

Uma leitura de chave privada deve passar por uma rota autenticada que:

1. localiza a entidade dona do arquivo;
2. confirma o condomínio do solicitante;
3. entrega o conteúdo ou uma URL assinada de curta duração.

Essa autorização precisa acontecer na rota/serviço que conhece a entidade. O
storage não aceita um `id_condominio` informado pelo cliente como autorização.

## Compatibilidade de migração

Registros existentes que tenham URL pública continuam sendo identificados por
`StorageService.isTrustedPublicUrl` somente quando host e caminho coincidirem
com a configuração legada. Eles podem ser lidos até a migração da entidade para
uma chave privada. URLs de outros hosts não são consideradas referências de
storage confiáveis.

Os consumidores que gravam o retorno de `uploadDataUrl` ou de `saveToAWS`
devem tratá-lo como chave opaca. O fluxo legado de PUT pré-assinado foi
desabilitado porque não permitia validar MIME, tamanho e assinatura no servidor.
