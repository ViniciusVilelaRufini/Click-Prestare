# Design: Radar de Risco de Churn (CRM integrado ao controle de acesso)
Date: 2026-06-24

## Summary
Transformar a função de alertas/health do CRM num **motor de risco operacional** que prevê cancelamento de condomínios a partir de sinais reais do controle de acesso. Foco (escolhido com o usuário) em dois preditores: **dispositivos offline** e **inatividade/suporte**. Sem schema novo nem tela nova — só leitura sobre tabelas existentes e evolução de uma função que já existe.

## Architecture
- **Backend** (`apps/api/src/app/crm/crm.service.ts`): novo helper `calcularRiscoChurn()` → `RiscoChurn { nivel, score, motivos[] }`. `montarCliente` passa a buscar os terminais (`facial_Devices.findMany select ultima_sincr`) para calcular a **duração real** de offline (hoje só conta >10min). `montarOverview` injeta os motivos operacionais na lista `alertas` (que vira o "Radar de Risco"). Campo `riscoChurn` é aditivo em `CrmClienteResumo`.
- **Frontend** (`apps/crm-web`): tipos `RiscoChurn/RiscoMotivo` + `riscoChurn` em `CrmCliente`; painel de Alertas do Overview vira **Radar de Risco**; badge de risco na tabela/cards de clientes; aba "Hardware & Acessos" do drawer lista os motivos.

## Components
- `calcularRiscoChurn(p)` — pontua: offline ≥3 dias (+45/alta), offline recente (+20/media), sem acesso ≥14d (+40/alta) ou ≥7d (+20/media) ou nenhum acesso com hardware (+30), backlog ocorrências ≥10 (+25) ou ≥5 (+12). `nivel = score≥45 'alto' | ≥20 'medio' | 'baixo'`.
- Overview "Radar de Risco" — reusa `ov.alertas` (com tipos novos `offline|inatividade|suporte`), já ordenado por severidade.
- Badge de risco (front) — `riscoClasse(nivel)` + `riscoLabel(nivel)`; aparece quando `nivel !== 'baixo'`.
- Drawer "Hardware & Acessos" — lista `riscoChurn.motivos`.

## Data Flow
`condominios.findMany` → por cond.: counts + `facial_Devices` rows → `calcularRiscoChurn` → `riscoChurn` no cliente → `montarOverview` agrega motivos em `alertas` → `/api/crm/overview` + `/api/crm/clientes` → front renderiza Radar, badge e drawer. Limiares de offline (10min) e janelas (7/14d) são constantes tunáveis.

## Error Handling
- Cada query Prisma já tem `.catch(() => default)`; offline-rows cai em `[]` → risco 'baixo'. Modo mock (`isConnected=false`) calcula `riscoChurn` no `mockClientes().map`, com `maxOfflineDias` sintético para demonstrar o Radar em dev.
- Cliente inativo (`ativo=false`) → risco 'baixo' (já é churn, não "em risco").

## Testing Strategy
- Manual: subir API+crm-web, abrir Overview (Radar populado no mock), abrir um condomínio com offline/inatividade no drawer e ver os motivos; badge na lista.
- Casos de borda: nenhum dispositivo, dispositivo que nunca sincronizou (`ultima_sincr=null`), sem acessos com/sem hardware, backlog alto.

## Open Questions
- Ações por motivo (playbook/abrir chamado) ficaram **fora** desta iteração (Abordagem 3, futuro).
- Queda de acessos (tendência período-a-período) e adoção de biometria foram despriorizados (YAGNI) — podem virar sinais adicionais depois.
