# Evidência — Segurança e isolamento

- 14 suítes de visitantes passaram com `PESSOAS_MIGRATION_ENABLED=true`.
- 14 suítes de visitantes passaram com `PESSOAS_MIGRATION_ENABLED=false`.
- 85 testes passaram em cada modo.
- Foi coberta a correção que impede a listagem de criar PIN ou executar UPDATE.
- Busca estática não encontrou padrões de `console.log/info/debug` contendo
  CPF, documento, foto, face, token, PIN ou `codigo_acesso`.
- Não foram encontrados segredos nos arquivos rastreados; arquivos `.env` não
  foram incluídos na busca.

Resultado: **PASS** para os testes automatizados avaliados. A validação de
isolamento com dois usuários reais de condomínios distintos ainda depende de
fixtures/contas de homologação, pois o banco consultado não possui visitantes.
