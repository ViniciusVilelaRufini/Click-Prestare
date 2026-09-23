# Especificação — Auditoria de bugs e vazamentos

## Objetivo

Encontrar e corrigir bugs funcionais e vazamentos de dados no banco, API,
sistema web e aplicativo antes da entrada de clientes reais.

## Escopo

- Rotas e serviços de autenticação, visitantes, moradores, unidades, acessos e
  arquivos.
- Fluxos do aplicativo Flutter e do sistema web.
- Isolamento por condomínio, apartamento e papel de usuário.
- Dados sensíveis: CPF/documentos, fotos, biometria, PINs, tokens e credenciais.
- Logs, mensagens de erro, respostas JSON, bundles e scripts de deploy.
- Integridade relacional e efeitos colaterais de leitura no MySQL/RDS.

## Modelo de ameaça

Serão considerados os seguintes perfis:

| Perfil | Acesso esperado | Abusos a testar |
|---|---|---|
| Morador | Própria unidade e condomínio vinculado | Trocar `id_condominio`, `id_apto` ou `id` de outro usuário |
| Síndico | Gestão do condomínio autorizado | Consultar outro tenant por parâmetro ou rota administrativa |
| Porteiro | Operação de portaria conforme permissão | Editar cadastro, obter PIN ou acessar documentos sem autorização |
| Administrador | Escopo administrativo explícito | Confusão entre conta global e tenant operacional |
| Usuário não autenticado | Nenhum dado privado | Acessar endpoints, arquivos, exports ou mensagens detalhadas |

## Classes de dados protegidos

- **Identidade:** nome, CPF/RG, telefone, e-mail e endereço.
- **Biometria:** `face_id`, imagens faciais, status de enrolamento e erros de
  sincronização.
- **Documentos:** fotos de documento, URLs de storage e metadados.
- **Acesso físico:** PINs, RFID, tokens de agente, credenciais de dispositivos
  e histórico de entrada/saída.
- **Autenticação:** hashes, refresh tokens, FCM tokens, cookies, QR tokens e
  segredos de integração.
- **Operação:** stack traces, SQL, endpoints internos, IDs cross-tenant e
  caminhos de arquivos.

## Superfícies a mapear

### API

- Autenticação, refresh, logout e MFA.
- Listagens e detalhes de visitantes, moradores, prestadores e unidades.
- Cadastro, edição, exclusão, aprovação, entrada e saída de visitantes.
- Convites, pendências, validação de PIN e acesso facial.
- Upload, download, exclusão e URLs assinadas de arquivos.
- Rotas de portaria, console, CRM e endpoints de diagnóstico.

### Aplicativo

- Login e troca de condomínio/unidade.
- Listas de visitantes, moradores, unidades e solicitações.
- Cadastro/edição/exclusão e tratamento de 401, 403, 404 e 5xx.
- Cache local, secure storage, logs de debug e deep links.
- Build release, endpoints, certificados e dados embutidos no APK.

### Sistema web

- Guards de rota, interceptors, menus e permissões de cada papel.
- Paginação, busca, filtros e exportações.
- DevTools/network responses, downloads e URLs públicas.
- Bundles JavaScript, source maps, arquivos estáticos e configuração de API.

### Banco e infraestrutura

- Tabelas legadas e migradas (`Visitantes`, `pessoas`, `visitas`, acessos,
  apartamentos e vínculos de usuários).
- Chaves estrangeiras, índices, unicidade e triggers.
- Usuários MySQL, grants, hosts permitidos, TLS e rede privada.
- Backup, snapshots, migrations, buckets e secrets do CI/CD.

## Método

1. Mapear superfícies e campos sensíveis sem expor valores.
2. Criar fixtures sintéticas com prefixo `QA_SECURITY_20260923`.
3. Exercitar autorização positiva e negativa em API/web/app.
4. Consultar o banco antes, durante e depois dos testes.
5. Para cada bug real, escrever teste falhando, corrigir e rodar a suíte.
6. Remover fixtures por chave exata e confirmar contagem zero.

## Matriz de testes

### Autorização e isolamento

1. Usuário A consulta listagem do próprio apartamento: permitido.
2. Usuário A informa `id_apto` de outra unidade: negado ou vazio.
3. Usuário A informa `id_condominio` de outro tenant: negado ou vazio.
4. Usuário sem vínculo tenta consultar apartamento existente: negado.
5. Porteiro tenta editar visitante quando `canManage` é falso: negado.
6. Operador autorizado executa entrada/saída somente no condomínio correto.
7. IDs inexistentes, negativos, duplicados e parâmetros `null` não vazam dados.

### Sanitização e vazamentos

1. Listagens não retornam `codigo_acesso`, senha, token, `face_id` ou URL
   privada sem necessidade operacional.
2. Detalhes de operador retornam somente campos permitidos pelo papel.
3. Erros de validação não repetem CPF, documento ou payload completo.
4. Erros 500 não incluem stack trace, SQL, host, senha ou tokens.
5. Logs não registram PII nem credenciais em sucesso ou falha.
6. Arquivos não podem ser baixados apenas alterando um ID ou URL.
7. Bundles, source maps e arquivos públicos não contêm secrets.

### Integridade e efeitos colaterais

1. GET de listagem não executa INSERT/UPDATE nem gera PIN.
2. Exclusão remove dependências permitidas sem deixar órfãos.
3. Falha parcial de transação faz rollback completo.
4. PIN ativo é único dentro do escopo definido.
5. Visita expirada não aparece como ativa ou presente.
6. Datas inválidas, término anterior e timezone são rejeitados corretamente.
7. Exclusão de pessoa não remove registro pertencente a outro condomínio.

### Resiliência

1. API indisponível mostra erro recuperável no app.
2. Token expirado direciona para autenticação sem apagar dados locais.
3. Timeout e retry não duplicam visitantes, visitas ou entradas.
4. Duplo clique e requisições concorrentes respeitam unicidade.
5. Paginação e busca não pulam nem misturam tenants.

## Critérios de sucesso

- Nenhum acesso cross-tenant retorna dados.
- Nenhum endpoint mobile expõe PIN, senha, token ou biometria sem autorização.
- Leituras não criam ou alteram credenciais inesperadamente.
- Erros não incluem SQL, stack trace, secrets ou PII.
- CRUD sintético completo termina com limpeza confirmada.
- Correções importantes têm teste de regressão e revisão independente.

## Severidade e resposta

- **Crítico:** exposição de credencial, biometria, documentos em massa,
  acesso cross-tenant ou escrita destrutiva sem autorização. Bloqueia release
  imediatamente.
- **Alto:** acesso indevido a PII, bypass de papel, vazamento persistente em
  logs/storage ou corrupção de integridade. Corrigir antes de produção.
- **Médio:** erro de fluxo, isolamento incompleto em caso específico, retry
  duplicado ou mensagens excessivas. Corrigir antes de liberar o módulo.
- **Baixo:** melhoria de observabilidade, UX ou documentação sem exposição.
  Registrar e priorizar.

Cada finding deverá conter: ativo afetado, pré-condições, passos reprodutíveis,
impacto, evidência sem PII, severidade, correção, teste de regressão e estado.

## Fixtures sintéticas

Todos os nomes, documentos e identificadores de teste usarão o prefixo:

```text
QA_SECURITY_20260923_
```

As fixtures deverão ser criadas em transação quando possível. Quando o fluxo
exigir commit, a limpeza será feita por marcador exato, dentro de transação,
com contagem antes/depois e verificação de arquivos associados. Nenhuma query
de limpeza poderá usar apenas nome parcial, `LIKE` amplo ou `DELETE` sem
filtro de tenant e marcador.

## Evidências e auditoria

Para cada fase serão guardados:

- comando ou teste executado;
- resultado PASS/FAIL/BLOCKED;
- contagens agregadas, sem PII;
- commit e arquivos alterados;
- logs sanitizados;
- risco residual e responsável pela decisão.

O relatório final terá uma tabela de findings, uma tabela de controles
verificados e uma decisão explícita: **aprovado**, **aprovado com ressalvas** ou
**bloqueado**.

## Limitações

- Dados reais existentes não serão alterados; fixtures terão marcador único.
- Operações AWS que alterem rede, backup ou produção exigem confirmação separada.
- Se não houver segundo condomínio/contas QA, o isolamento será validado por
  testes de serviço e ficará marcado como incompleto no relatório dinâmico.

## Fora de escopo sem aprovação adicional

- Alterar regras de negócio não relacionadas a segurança ou bugs encontrados.
- Apagar dados reais existentes, mesmo que pareçam antigos.
- Abrir o RDS para a internet ou liberar `0.0.0.0/0`.
- Rotacionar secrets de produção sem plano de rollback.
- Publicar app, API ou migrations diretamente sem o gate final.
