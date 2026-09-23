# Evidências sanitizadas — correções de segurança

## Achados corrigidos

- Listagens móveis de visitantes não geram PIN por efeito colateral e não devolvem `codigo_acesso`.
- Autorizações migradas precisam estar autorizadas, ativas e recentes (janela de 10 minutos) para seleção e check-in.
- Expurgo LGPD de fotos/documentos usa atualização condicional antes de apagar objetos, evitando apagar uma foto substituta em condição de corrida.

## Verificações

- API visitantes com migração habilitada: 15 suítes, 91 testes aprovados.
- API visitantes com migração desabilitada: 15 suítes, 91 testes aprovados.
- Typecheck da API: aprovado.
- Flutter: 176 testes aprovados.
- APK release: build aprovado após versão `1.2.25+79`.

Os testes usam dados sintéticos; nenhum segredo ou dado pessoal é registrado neste documento.
