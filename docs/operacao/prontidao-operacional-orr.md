# Revisão de prontidão operacional (ORR)

Checklist do fundador antes de liberar uma funcionalidade nova em produção. Marque cada item no PR ou no plano em `docs/superpowers/plans/`. Item "N/A" exige uma frase de justificativa.

## Código e testes
- [ ] CI verde (`.github/workflows/ci.yml`: Jest + typecheck) e `npm audit` sem crítica nova.
- [ ] Testes cobrem o caminho principal e o de erro.
- [ ] Rota nova do app mobile está no `mobile-auth` do NestJS (produção), não só no Express de dev.
- [ ] Autorização por papel e isolamento por condomínio verificados.

## Dados
- [ ] Migração SQL escrita, **aplicada no RDS antes do push** e verificada.
- [ ] Migração aditiva (compatível com o código anterior, para permitir rollback).
- [ ] Dados pessoais novos classificados e com retenção definida (`classificacao-e-retencao-de-dados.md`).

## Operação
- [ ] Chamadas externas têm timeout e tratamento de falha.
- [ ] Logs de erro suficientes para diagnosticar, sem dados pessoais nem segredos.
- [ ] Novo env/segredo cabe no limite de 4096 caracteres do EB (`cotas-e-limites.md`).
- [ ] Impacto em cotas (Bedrock, SMTP, conexões do RDS) estimado.
- [ ] Throttle adequado para a rota nova.
- [ ] Alarmes existentes cobrem a funcionalidade, ou há alarme/canary novo a criar.

## Liberação e recuperação
- [ ] Deploy pelo workflow na `main`; verificação automática passou.
- [ ] Versão anterior identificada para rollback (`runbooks.md`).
- [ ] Compatibilidade com versões antigas do app mobile e do agente local.
- [ ] Clientes avisados se houver mudança visível (modelos em `responsabilidades-e-escalonamento.md`).

## Pós-liberação (24 h)
- [ ] Painel `Prestare-Operacao` sem anomalia e filtro ERROR sem novidade.
- [ ] Feedback inicial recolhido de pelo menos um cliente, se aplicável.
