# Evidência — CRUD sintético no banco autorizado

Com autorização explícita, foi executada uma transação controlada no banco
atual usando o marcador `QA_SYNTH_20260923`.

- Criado registro sintético em `pessoas`: PASS.
- Criada visita sintética relacionada em `visitas`: PASS.
- Atualizado telefone sintético: PASS.
- Excluída a visita e a pessoa: PASS.
- Confirmada ausência do marcador após limpeza: PASS.
- Baseline posterior: `pessoas=0`, `visitas=0`, `Visitantes=0` e sem
  inconsistências: PASS.

O banco possui apenas um condomínio, portanto não é possível comprovar
isolamento entre dois condomínios reais neste momento. Esse teste continua
pendente para um ambiente com pelo menos dois tenants de teste.
