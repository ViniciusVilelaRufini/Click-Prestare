# DPA do Railway — situação e pontos para análise jurídica

Atualizado em 11/09/2026.

O Railway é a infraestrutura onde rodam a API e o banco de dados de produção do
sistema Prestare. Na cadeia LGPD: **condomínio = controlador** (conforme Anexo II do
contrato de licença), **Prestare = operadora**, **Railway = suboperador**.

## Status

DPA **assinado e vigente**.

| Item | Valor |
|---|---|
| Envelope DocuSign vigente | `49E2510B-2BCC-8705-81D6-75248C339EC1` |
| Assinado por | Erika Augusta Vilela, Title "Sócio-Administrador" |
| Contra-assinado por | Christian Ohrgaard, Head of Operations (Railway Corporation) |
| Effective Date | 2026-09-11 |
| Data exporter (Exhibit B) | Prestare Gestão Condominial Inteligente — R. Maranhão 1368, Sl 30, Centro, Catanduva/SP, 15800-020 |
| Contato do exporter | contato@prestaregestao.com.br |
| Data importer | Railway Corporation — 548 Market St PMB 68956, San Francisco, CA 94104 — privacy@railway.com |

**Envelope anterior a desconsiderar:** `8DEE31E2-DEA1-8139-83D7-4DCB0561C20C`, assinado
por Vinicius Vilela Rufini (pessoa física, sem poderes de representação). Convém pedir
ao suporte do Railway a confirmação por escrito de que o envelope novo substitui esse.

Conta Railway: plano Hobby, Tax ID 09.195.104/0001-73, endereço de cobrança da sede.
Confere com o CNPJ da empresa.

## PONTO CRÍTICO — Exhibit A declara ausência de dado sensível

O Exhibit A (pág. 7) encerra com:

> Sensitive Data or Special Categories of Data: **None**

**Isso diverge do que o sistema efetivamente armazena no Railway.** O schema do banco de
produção (`click-cond-web/prisma/schema.prisma`) mantém, em três tabelas de pessoas:

- `foto_pessoa` — `LongText`, imagem do rosto gravada no próprio banco
- `foto_documento` — `LongText`, imagem do documento de identificação
- `face_id`, `face_enrolled_at`, `face_sync_status` — vínculo dessa foto com o cadastro
  no terminal de reconhecimento facial
- tabela `Acessos_Facial` — histórico de reconhecimentos (quem, qual dispositivo, quando)

Imagem facial empregada para identificar pessoa é **dado biométrico**, portanto dado
pessoal sensível (LGPD art. 5º, II; GDPR art. 9º).

Risco: o Exhibit A delimita o objeto do tratamento. Num incidente de segurança ou em
fiscalização da ANPD, o contrato vigente exclui justamente a categoria de dado de maior
risco tratada pela Prestare.

O powerform não permite editar o Exhibit A. Encaminhamentos possíveis:
1. Solicitar adendo a `privacy@railway.com` corrigindo o Exhibit A; ou
2. Registrar formalmente a divergência no dossiê de conformidade.

## Outros pontos de atenção

- **Campo *Customer* no bloco de assinatura:** consta `ERIKA AUGUSTA VILELA` (pessoa
  física), enquanto o Exhibit B identifica a pessoa jurídica. Inconsistência interna. No
  Exhibit B falta o sufixo `LTDA-ME` e não há CNPJ.
- **Poderes de representação:** o contrato de licença qualifica a empresa como
  "representada por suas sócias proprietárias" Erika Augusta Vilela **e** Ana Glaucia
  Damian Torrecilhas, com ambas no bloco de assinaturas. Verificar no contrato social se
  a administração é isolada ou conjunta — se conjunta, a assinatura isolada não vincula.
- **Exhibit B, "Activities relevant to the data transferred":** deixado em branco.
- **Exhibit A, categorias de titulares:** "Customers and Customer employees". Os titulares
  reais são moradores, visitantes, prestadores de serviço e funcionários do condomínio.

## Cláusulas relevantes do texto assinado

- **Seção 2.1** — papéis. Prevê expressamente o cenário de suboperador, que é o da Prestare.
- **Seção 6.2** — suboperadores: aviso com no mínimo 10 dias e objeção por escrito em 10
  dias por fundamento razoável de proteção de dados. Silêncio = autorização tácita.
  Lista em trust.railway.com/item/subprocessors (hoje: Cloudflare, Stripe, Customer.io,
  Fathom Analytics, Causal). As notificações vão para o e-mail do Exhibit B.
- **Seção 6.4** — o Railway responde perante a Prestare pelo descumprimento do suboperador.
- **Seção 9.1** — o tratamento ocorre primariamente nos **Estados Unidos**. Armazenamento
  local só é oferecido a clientes de Paid Services.
- **Seção 9.2/9.3** — Cláusulas Contratuais Padrão da UE. Aplica-se o **Módulo 3
  (Processor to Subprocessor)**. Lei aplicável: **República da Irlanda**; foro: tribunais
  irlandeses. Nenhuma menção à LGPD ou às cláusulas-padrão da ANPD.
- **Seção 9.6.1** — pedidos de agências governamentais: o Railway se compromete a
  redirecionar à Prestare, notificar quando possível e não divulgar voluntariamente.
- **Seção 8** — incidentes: informa "sem demora indevida", sem prazo fixo em horas.
- **Seção 5.1** — auditoria no máximo uma vez por ano civil, **custos por conta da Prestare**.
- **Seção 12** — ao término, devolução ou exclusão à escolha da Prestare.
- **Seção 13** — quanto a Account Data e Usage Data, o Railway é **controlador autônomo**.
- **Exhibit C** — medidas de segurança. Infraestrutura sobre **Google Cloud Platform**,
  criptografia em repouso e em trânsito (TLS/SSL, WireGuard), backups diários testados,
  2FA, monitoramento via Drata. Railway é SOC 2 Type II e SOC 3.

## Pendências correlatas

1. Confirmar com o Railway a substituição do envelope antigo e arquivar o PDF final.
2. Inscrever contato@prestaregestao.com.br nas notificações de suboperador em
   trust.railway.com e garantir leitura dentro do prazo de 10 dias.
3. A política de privacidade publicada
   (`click-cond-web/apps/portaria-web/public/politica-de-privacidade.html`) não menciona
   transferência internacional, operadores no exterior nem os papéis controlador/operador.
   Precisa ser alinhada ao que o DPA agora formaliza.
4. Verificar se o Anexo II do contrato com o condomínio exige informar nominalmente os
   suboperadores — se exigir, o Railway e os demais fornecedores precisam constar ali.
5. Levantar o mesmo para os demais fornecedores que tocam dado pessoal: hospedagem do
   painel web, push notifications, gateway de pagamento e provedor de IA do assistente.
6. Pendências de Play Store na mesma linha: declaração de dados biométricos, Data Safety
   e URL de exclusão de conta.
