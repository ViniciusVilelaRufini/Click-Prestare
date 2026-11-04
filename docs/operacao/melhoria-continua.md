# Melhoria contínua

Dono: o fundador. Objetivo: aprender com incidentes e feedback sem burocracia.

## Ciclos de feedback

| Fonte | Como chega | Tratamento |
|---|---|---|
| Clientes | WhatsApp comercial (aba WhatsApp do CRM), e-mail, contato direto | Registrar no CRM; classificar como defeito, pedido ou dúvida |
| Usuários do app | Avaliações nas lojas, mensagens | Triagem semanal |
| Alarmes e logs | E-mail do SNS `prestare-alertas`, filtro ERROR | `runbooks.md` |
| Pós-incidente | Modelo abaixo | Ações com dono e prazo |
| Checklist ORR | `prontidao-operacional-orr.md` | Ajustar o checklist quando algo escapar |

## Revisão mensal (1 hora, primeira semana do mês)

1. KPIs do mês (`kpis-operacionais.md`) contra as metas.
2. Cotas e limites (`cotas-e-limites.md`): algo acima de 70%?
3. Drift: console x saved configuration do EB; se mudou, criar nova saved configuration (base atual: `prestare-api-baseline-2026-11-04`).
4. Incidentes e ações abertas: o que fechou, o que atrasou.
5. Riscos abertos (`prioridades-e-governanca.md`): reavaliar.
6. Pendências de segurança: rotações e dependências (Dependabot, `npm audit`).
7. Registrar a decisão do mês e atualizar os documentos.

## Modelo de pós-incidente (sem culpados)

Preencher em até 5 dias úteis e guardar em `docs/operacao/incidentes/AAAA-MM-DD-titulo.md` (modelo em `incidentes/README.md`).

```
# Incidente: [título]
Início e fim:                 Duração:
Impacto (quem, o quê):
Detecção (alarme, cliente, acaso) e tempo até detectar:
Linha do tempo:
Causa raiz (5 porquês):
O que funcionou:
O que não funcionou:
Ações (dono, prazo):
 - [ ] correção
 - [ ] prevenção
 - [ ] detecção (alarme ou teste novo)
Runbook ou documento a atualizar:
Cliente avisado? Quando?
```

## Testes de recuperação

Pelo menos duas vezes por ano: restaurar o banco em instância temporária e fazer rollback de versão em teste; registrar em "Testes executados" de `plano-recuperacao-desastre.md`.
