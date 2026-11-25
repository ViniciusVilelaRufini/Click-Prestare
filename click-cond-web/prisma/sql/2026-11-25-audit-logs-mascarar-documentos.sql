-- OPCIONAL — só aplicar com autorização do dono (altera registros de auditoria já gravados).
--
-- Mascara documento/CPF e telefone já gravados em audit_logs.detalhes por versões antigas, que
-- guardavam o valor inteiro (ex.: "documento":"45346648852", até 15/11/2026). Mesma regra que o
-- AuditoriaService passa a aplicar nas gravações novas: só os últimos dígitos ficam visíveis.
-- É anonimização no mesmo espírito da purga LGPD (crm-condominios.service): o fato registrado
-- (quem, o quê, quando) não muda; só o dado pessoal deixa de ficar legível para operadores.
--
-- Também mascara as folhas "de"/"para" dos diffs de edição e omite credenciais (QR/tag) — ver
-- a segunda parte.
--
-- Idempotente: valores já mascarados (com *) não casam o padrão. MySQL 8.4 (REGEXP_REPLACE ICU).
-- Prévia em produção (25/11, só SELECT): 156 linhas; "45346648852" → "***.***.*88-52"; 152 seguem
-- JSON válido e as 4 restantes (ids 3, 4, 44, 344, set/2026) JÁ eram JSON inválido antes (cortadas
-- em 2000 caracteres por versão antiga) — o mascaramento não piora nenhuma.

-- Prévia (rodar antes, só leitura):
SELECT COUNT(*) AS linhas_com_documento_aberto
  FROM audit_logs
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"';

UPDATE audit_logs
   SET detalhes = REGEXP_REPLACE(
         detalhes,
         '"(documento|doc|cpf|doc_identificacao|rg)"([[:space:]]*:[[:space:]]*)"[0-9.-]*([0-9]{2})-?([0-9]{2})"',
         '"$1"$2"***.***.*$3-$4"')
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"';

UPDATE audit_logs
   SET detalhes = REGEXP_REPLACE(
         detalhes,
         '"(telefone|celular|whatsapp)"([[:space:]]*:[[:space:]]*)"[^"*]*([0-9]{4})"',
         '"$1"$2"*****$3"')
 WHERE detalhes REGEXP '"(telefone|celular|whatsapp)"[[:space:]]*:[[:space:]]*"[^"*]*[0-9]{4}"';

-- ---------------------------------------------------------------------------------------------
-- Diffs de edição (moradores.service: detalhes.changes = { documento: {de, para}, telefone: {de,
-- para}, qrcode_acesso: {de, para}, tag_rfid: {de, para} }). O padrão acima só casa valor string
-- direto na chave; aqui o valor é um objeto. Formato gravado (JSON.stringify, sem espaços):
--   "documento":{"de":"45346648852","para":"12345678909"}
--   → "documento":{"de":"***.***.*88-52","para":"***.***.*89-09"}
--   "telefone":{"de":"17996608148","para":null}  → "telefone":{"de":"*****8148","para":null}
--   "qrcode_acesso":{"de":"QR-A","para":"QR-B"}  → "qrcode_acesso":"(omitido)"
--
-- Como casa: [{][^{}]* anda dentro do objeto (sem sair dele: não atravessa chave), até a folha
-- "de" ou "para" cujo valor ainda é só dígito/ponto/traço. O prefixo (grupo 1) é devolvido igual e
-- só a folha muda. Cada casamento consome o prefixo desde a chave, então UMA passada mascara UMA
-- folha por objeto (a última, porque [^{}]* é guloso): por isso o UPDATE de diff roda DUAS vezes
-- (o objeto tem no máximo "de" e "para"). Idempotente: folha mascarada tem *, não casa de novo.
-- Sem barra invertida de propósito (no literal do MySQL ela é escape): chave/colchete literal vão
-- em classe ([{], [(]).

-- Prévia do diff (só leitura): antes x depois, e se o resultado continua JSON válido.
SELECT id,
       detalhes,
       REGEXP_REPLACE(
         detalhes,
         '("(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*)"[0-9.-]*([0-9]{2})-?([0-9]{2})"',
         '$1"***.***.*$4-$5"') AS depois_1a_passada,
       JSON_VALID(detalhes) AS json_valido_antes
  FROM audit_logs
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"'
 LIMIT 20;

SELECT COUNT(*) AS diffs_com_documento_aberto
  FROM audit_logs
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"';

SELECT COUNT(*) AS diffs_com_telefone_aberto
  FROM audit_logs
 WHERE detalhes REGEXP '"(telefone|celular|whatsapp)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[^"*]*[0-9]{4}"';

SELECT COUNT(*) AS linhas_com_credencial_aberta
  FROM audit_logs
 WHERE detalhes REGEXP '"(qrcode_acesso|qrcode|tag_rfid|codigo_validacao)"[[:space:]]*:[[:space:]]*(?![[:space:]]*"[(]omitido[)]")("[^"]*"|[{][^{}]*[}]|-?[0-9]+)';

-- Documento dentro de diff — 1ª passada (mascara a folha "para", ou a única aberta).
UPDATE audit_logs
   SET detalhes = REGEXP_REPLACE(
         detalhes,
         '("(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*)"[0-9.-]*([0-9]{2})-?([0-9]{2})"',
         '$1"***.***.*$4-$5"')
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"';

-- Documento dentro de diff — 2ª passada (mesmo comando: pega a folha "de" que sobrou).
UPDATE audit_logs
   SET detalhes = REGEXP_REPLACE(
         detalhes,
         '("(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*)"[0-9.-]*([0-9]{2})-?([0-9]{2})"',
         '$1"***.***.*$4-$5"')
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"';

-- Telefone dentro de diff — 1ª e 2ª passadas (mesma razão).
UPDATE audit_logs
   SET detalhes = REGEXP_REPLACE(
         detalhes,
         '("(telefone|celular|whatsapp)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*)"[^"*]*([0-9]{4})"',
         '$1"*****$4"')
 WHERE detalhes REGEXP '"(telefone|celular|whatsapp)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[^"*]*[0-9]{4}"';

UPDATE audit_logs
   SET detalhes = REGEXP_REPLACE(
         detalhes,
         '("(telefone|celular|whatsapp)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*)"[^"*]*([0-9]{4})"',
         '$1"*****$4"')
 WHERE detalhes REGEXP '"(telefone|celular|whatsapp)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[^"*]*[0-9]{4}"';

-- Credenciais (QR de acesso, tag RFID, código de validação): o valor inteiro — string, número ou
-- o objeto {de, para} — vira a string "(omitido)". Trocar o valor (e não apagar a chave) mantém o
-- JSON válido sem mexer em vírgula. O lookahead (?!...) pula o que já está omitido (idempotente).
-- "codigo" sozinho NÃO entra aqui: em linhas antigas ele também nomeia coisas que não são
-- credencial; a gravação nova e o CSV já o omitem. "codigo_rastreio" (encomenda) nunca casa.
UPDATE audit_logs
   SET detalhes = REGEXP_REPLACE(
         detalhes,
         '"(qrcode_acesso|qrcode|tag_rfid|codigo_validacao)"([[:space:]]*:[[:space:]]*)(?![[:space:]]*"[(]omitido[)]")("[^"]*"|[{][^{}]*[}]|-?[0-9]+)',
         '"$1"$2"(omitido)"')
 WHERE detalhes REGEXP '"(qrcode_acesso|qrcode|tag_rfid|codigo_validacao)"[[:space:]]*:[[:space:]]*(?![[:space:]]*"[(]omitido[)]")("[^"]*"|[{][^{}]*[}]|-?[0-9]+)';

-- Conferência: todas devem dar 0.
SELECT COUNT(*) AS restantes
  FROM audit_logs
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"';

SELECT COUNT(*) AS diffs_documento_restantes
  FROM audit_logs
 WHERE detalhes REGEXP '"(documento|doc|cpf|doc_identificacao|rg)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[0-9.-]{7,}"';

SELECT COUNT(*) AS diffs_telefone_restantes
  FROM audit_logs
 WHERE detalhes REGEXP '"(telefone|celular|whatsapp)"[[:space:]]*:[[:space:]]*[{][^{}]*"(de|para)"[[:space:]]*:[[:space:]]*"[^"*]*[0-9]{4}"';

SELECT COUNT(*) AS credenciais_restantes
  FROM audit_logs
 WHERE detalhes REGEXP '"(qrcode_acesso|qrcode|tag_rfid|codigo_validacao)"[[:space:]]*:[[:space:]]*(?![[:space:]]*"[(]omitido[)]")("[^"]*"|[{][^{}]*[}]|-?[0-9]+)';

-- O mascaramento não pode criar JSON inválido: compare com a contagem de antes (4 linhas antigas,
-- ids 3, 4, 44, 344, já eram inválidas).
SELECT COUNT(*) AS json_invalido FROM audit_logs WHERE detalhes IS NOT NULL AND JSON_VALID(detalhes) = 0;
