# Relatório — PIN por vínculo residencial

## RED observado

Depois de adicionar a regressão para uma conta `Sindico` vinculada ao apartamento da visita, executei:

```powershell
cd C:\tmp\pin-vinculo\click-cond-web
npm exec -- nx test @org/api --runInBand --testPathPatterns=visitantes.pin-morador.spec.ts
```

Resultado esperado e observado: 2 falhas, uma para `PESSOAS_MIGRATION_ENABLED=false` (legado) e outra para `true` (Pessoas/Visitas), ambas com `Expected: "123456"; Received: null`.

Antes disso a primeira execução foi bloqueada sem testes por falta do cliente Prisma gerado (`Cannot find module './generated'`). Foi corrigido somente no ambiente local com `npm exec prisma generate --schema=prisma/schema.prisma` e o RED foi então repetido e confirmado pelo motivo de negócio acima.

## Mudança

- Em `findAllMobileViaPessoasVisitas` e `findAllMobile`, o retorno de `codigo_acesso` agora depende somente de a conta estar nos `aptosPermitidos` e de a visita não possuir `data_saida`.
- A checagem `userType === 'Morador'` foi removida exclusivamente dos dois mapeamentos móveis.
- A regressão cobre uma conta `Sindico` vinculada com PIN ativo nos dois ramos da migração.
- Os cenários de conta sem vínculo e visita encerrada foram exercitados nos dois ramos.
- A expectativa existente do caminho Pessoas/Visitas foi atualizada para refletir o requisito novo de PIN por vínculo, inclusive sem `userType` informado.

## GREEN

```powershell
npm exec -- nx test @org/api --runInBand --testPathPatterns=visitantes.pin-morador.spec.ts
```

Passou: 1 suíte, 7 testes.

```powershell
npm exec -- nx test @org/api --runInBand --testPathPatterns=visitantes
```

Passou: 23 suítes, 131 testes. Há logs de erro esperados por testes de retenção LGPD e remoção com FK, mas o comando terminou com código 0.

```powershell
npm exec -- nx run @org/api:typecheck
```

Passou com código 0.

## Preocupações

- A execução completa `npm exec -- nx test @org/api --runInBand` excedeu o limite local de 60 segundos antes de emitir um resumo final; por isso a verificação ampla foi o recorte aplicável de visitantes (23 suítes/131 testes), conforme o escopo.
- `npm ci --ignore-scripts` reportou vulnerabilidades já presentes nas dependências (89 no total); nenhuma dependência ou lockfile foi alterado por esta tarefa.
