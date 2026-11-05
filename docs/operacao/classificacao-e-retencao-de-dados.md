# Classificação e retenção de dados — Prestare

Última revisão: 2026-11-04 · Dono: o fundador · Revisão: semestral e a cada novo tipo de dado coletado. Papéis LGPD: o condomínio é o **controlador**; a Prestare é **operadora** (trata os dados a mando do condomínio). Controles relacionados: OC-3 e OC-4 em [objetivos-de-controle.md](objetivos-de-controle.md).

Nomes de modelos vêm de `click-cond-web/prisma/schema.prisma`; código em `click-cond-web/apps/api/src/app/`.

## 1. Classes

| Classe | Definição | Tratamento mínimo |
|---|---|---|
| **C4 Sensível** | Biometria e documentos de identificação | Prazo de vida definido, expurgo físico, consentimento, nunca em log, mascarado na interface |
| **C3 Pessoal** | Identifica pessoa: nome, e-mail, telefone, CPF, placa, apartamento, eventos de acesso | Acesso por papel e por condomínio (`TenantGuard`), auditoria |
| **C2 Credencial/segredo** | Senhas (hash), JWT, códigos MFA (hash), tokens internos, chaves de nuvem | Nunca no repositório; só hash quando persistido; rotação (ver plano de incidentes) |
| **C1 Interno** | Configuração do condomínio, regras de acesso, textos de comunicados | Acesso por papel |
| **C0 Público** | Conteúdo da landing, `/sobre` | Livre |

## 2. Inventário

| Dado | Onde | Classe | Retenção real |
|---|---|---|---|
| Foto de rosto de morador (`Moradores.foto_pessoa`, `face_id`) | S3 privado `prestare-arquivos-850401152034` (`moradores/`), entregue por URL assinada de até 1 h + banco + terminal facial | C4 | Enquanto o morador estiver vinculado; apagada ao revogar a biometria ou excluir a conta/morador |
| Foto de rosto e de documento de visitante/pessoa (`Visitantes`, `Pessoas`: `foto_pessoa`, `foto_documento`) | S3 (`visitantes/`, `convites/`) + banco | C4 | **90 dias** após o fim da visita (expurgo diário); só o arquivo e a coluna são apagados, o registro da visita permanece |
| Foto/documento de prestador (`Prestadores_servico`) | S3 + banco | C4 | Sem expurgo automático hoje — ver pendências |
| Número do documento (`doc_identificacao`, `documento`) | Banco | C3/C4 | Segue o registro; exibido mascarado na interface |
| Convites de visita (vencidos, abandonados, recusados) | Banco | C3 | **7 dias** após o fim da validade (`DIAS_RETENCAO_CONVITE`) |
| Cadastro de usuário (`Users`: nome, e-mail, CPF, telefone, foto, `fcm_token`) | Banco | C3 | Enquanto a conta existir; exclusão pelo titular remove a conta |
| Eventos de acesso (`Acessos_Facial`, visitas, `Auditoria`, `AuditLog`) | Banco | C3 | Sem prazo de expurgo definido hoje — ver pendências |
| Consentimentos | Banco (append-only) | C3 | Guardados como prova; a revogação é novo registro |
| Senhas | `Users.password`, `Funcionarios_Portaria`, `crm_admins` | C2 | bcrypt (hashes MD5 legados migram no login) |
| Código MFA | `Mfa_Challenges` | C2 | Hash bcrypt; vale 10 min, apagado ao ser usado |
| Dispositivo confiável MFA | `User_Trusted_Devices` | C2 | 30 dias; só o hash SHA-256 do token é guardado |
| Perguntas e respostas do assistente IA | Enviadas ao Bedrock (sa-east-1) ou ao Gemini na contingência | C3 | Ver pendências sobre o contrato de retenção do provedor |
| Logs da aplicação | CloudWatch Logs | C1 (podem conter ids) | 30 dias |
| Versões antigas de arquivos | Versionamento do bucket de arquivos | C3/C4 | 90 dias após deixar de ser a versão atual (regra de expiração de versões não correntes) |
| Segredos (`/prestare/api/*`) | SSM Parameter Store, SecureString com KMS `alias/prestare-dados` | C2 | Até serem rotacionados; sem valor no repositório |
| Backups do RDS | AWS (criptografados) | C3/C4 | 7 dias (backup automático + PITR); a réplica Multi-AZ não é backup (ver [plano-recuperacao-desastre.md](plano-recuperacao-desastre.md)) |

## 3. Como o expurgo funciona (o que de fato roda)

### 3.1 Visitantes e pessoas — 90 dias

`VisitantesService.tickRetencaoDadosVisitantes(diasRetencao = 90)` em `visitantes/visitantes.service.ts`:

1. Roda 5 minutos após o boot e depois a cada 24 h (`setTimeout`/`setInterval`).
2. Seleciona visitas com `data_saida` anterior ao prazo (e, para `Pessoas`, sem visita aberta há mais de 90 dias).
3. Apaga os arquivos no storage com `StorageService.deleteUrl(url, PREFIXOS_FOTO_VISITANTE)` e zera `foto_pessoa`/`foto_documento` no banco.
4. Registra o total em log (`[LGPD Retenção]`) e em auditoria (`detalhes.prazoDias`).
5. A falha em uma etapa não interrompe a outra (o expurgo de `Pessoas` roda mesmo se o legado `Visitantes` falhar).

Teste: `visitantes/retencao-lgpd-pessoas.spec.ts`.

### 3.2 Proteção do próprio expurgo

`deleteUrl` em `common/storage/storage.service.ts` só apaga se:
- a URL pertence ao storage configurado (URL de outro host é ignorada; com o bucket privado, a chave é extraída da URL assinada ou do caminho guardado);
- a key não contém `..`;
- a key começa com um dos prefixos do dono: `PREFIXOS_FOTO_CONVITE` (`convites/`), `PREFIXOS_FOTO_VISITANTE` (`visitantes/`, `convites/`), `PREFIXOS_FOTO_MORADOR` (`moradores/`).

Motivo: o valor de foto pode vir do cliente; sem isso um `foto_url` forjado faria o expurgo apagar objetos arbitrários do bucket. Teste: `common/storage/storage-delete-prefixo.spec.ts`. A função devolve `false` sem lançar erro: o expurgo é best-effort e a falha só aparece como `warn` nos logs.

### 3.3 Convites — 7 dias

`ConvitesService.tickRetencaoConvites` (`convites/convites.service.ts`): mesmo ciclo diário (6 min após o boot), apaga a foto e o registro dos convites expirados (aguardando/preenchidos) e recusados, até 500 por rodada. Convite confirmado não é apagado: virou `Visitantes` e segue o prazo de 90 dias.

### 3.4 Biometria do morador

- Revogação do consentimento (`ConsentimentosService.revogarBiometria`): apaga a foto (`PREFIXOS_FOTO_MORADOR`) e registra a revogação sem editar o consentimento original. Teste: `consentimentos/revogar-biometria-foto.spec.ts`.
- Exclusão de conta (`POST /users/delete-account`, `auth/mobile-auth.service.ts`): remove o acesso web do funcionário e manda o terminal apagar o rosto (`unsyncMorador`, best-effort). Teste: `auth/delete-account-facial.spec.ts`.
- Rede de segurança: `tickFantasmas` (facial) remove rostos órfãos dos terminais Dahua e Intelbras, inclusive de prestadores, e audita como `FANTASMAS_REMOVIDOS`.

### 3.5 Condomínio que sai da base

`CrmCondominiosService.purgar` (`crm/crm-condominios.service.ts`): só aceita condomínio **já desativado** e a confirmação pelo nome; se houver histórico de acessos, exige opção explícita (`purgarHistoricoAcessos`). Desativação e reativação ficam em auditoria (`DEACTIVATE`/`REACTIVATE`).

## 4. Direitos do titular (LGPD art. 18)

| Pedido | Como atender hoje |
|---|---|
| Exclusão | Titular usa "excluir conta" no app; para visitante, o expurgo dos 90 dias ou pedido ao condomínio, que aciona o fundador |
| Revogação de biometria | Fluxo de revogação no app/portaria (`ConsentimentosService`) |
| Acesso / correção | Pelo condomínio (controlador) e, em apoio, pelo fundador via e-mail/WhatsApp |
| Portabilidade | Sob demanda, manual, pelo fundador |

Prazo interno de resposta ao condomínio: 5 dias úteis. Responsável: o fundador.

## 5. Riscos aceitos / pendentes

1. **Fotos**: desde 2026-11-04 ficam em bucket privado (Block Public Access, SSE-KMS com bucket key, versionamento, política só HTTPS, ACLs desabilitadas) e são servidas por URL assinada de até 1 h. Foram migrados 8 objetos do bucket público antigo `storage-click-dev` (outra conta, intocado e ainda público até ser desativado); 12 mídias de teste do WhatsApp não foram recuperáveis. Atenção: o versionamento guarda por 90 dias a versão anterior de um arquivo apagado ou substituído, então o expurgo de 90 dias só remove o dado de fato ao fim de mais 90 dias; considerar isso ao atender pedido de exclusão (apagar também as versões, se o titular exigir).
2. **Expurgo é best-effort**: se a remoção no S3 falhar, a coluna é zerada mas o objeto pode permanecer órfão. Pendência: varredura periódica de objetos sem referência (ainda não existe).
3. **Prestadores** e **eventos de acesso/auditoria** não têm prazo de expurgo automático. Decisão pendente de prazo (proposta inicial: 12 meses para eventos de acesso, 5 anos para auditoria e consentimentos), a ser fechada no próximo trimestre.
4. **Assistente IA**: confirmar e documentar a política de retenção/treinamento do Bedrock (esperado: não usa dados para treinar) e do Gemini antes de ligar a contingência para dados de clientes reais.
5. **Sem dados reais ainda**: tudo no RDS é teste; este documento vale para produção e deve ser reconferido contra o banco real no primeiro cliente.
6. Backups do RDS (7 dias) carregam dados já expurgados até saírem da janela de retenção. Com várias instâncias, o expurgo e demais tarefas agendadas rodam uma vez por cluster (trava `GET_LOCK`).
7. O expurgo roda dentro da API (timer em processo, com trava distribuída); se a API ficar fora do ar por dias, o expurgo atrasa. Os logs `[LGPD Retenção]` devem aparecer a cada dia — ausência é sinal de alerta.
