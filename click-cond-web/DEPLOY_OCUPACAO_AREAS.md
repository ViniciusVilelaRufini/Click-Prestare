# Deploy — Contador de ocupação das Áreas de Lazer

Feature: mostrar no app quantas pessoas estão dentro de cada área de lazer
(academia, quadra, etc.), derivado dos acessos dos terminais faciais/catracas
vinculados à área. Reset diário à meia-noite.

## 1) SQL manual em produção (Railway NÃO roda migrate)
Rodar ANTES do deploy da API. Idempotente.

```sql
-- Coluna de vínculo terminal -> área de lazer
ALTER TABLE Facial_Devices ADD COLUMN id_area_social INT NULL;
ALTER TABLE Facial_Devices ADD INDEX idx_facdev_area (id_area_social);
-- FK opcional (limpa o vínculo se a área for removida)
ALTER TABLE Facial_Devices
  ADD CONSTRAINT fk_facdev_area
  FOREIGN KEY (id_area_social) REFERENCES Areas_Sociais(id) ON DELETE SET NULL;
```

> Script idempotente equivalente: `scratchpad/mig_area_ocupacao.cjs`
> (checa information_schema antes de cada ALTER).

## 2) prisma generate
Já refletido em `prisma/schema.prisma` (`Facial_Devices.id_area_social`,
relation `Areas_Sociais.devices`). Rodar `npx prisma generate` no build.

## 3) Deploy
- API NestJS (Railway): push master.
- portaria-web (Vercel): merge master→main + push (formulário de terminais
  agora tem o seletor "Área de Lazer Monitorada").
- App Flutter: novo build para o badge de ocupação em `CellAreaSocial`.
- Express (dev): não vai a prod; já atualizado para paridade no emulador.

## Como usar
1. Síndico → Terminais Faciais → editar o facial/catraca da academia →
   campo "Área de Lazer Monitorada" → escolher a área → salvar.
2. Conforme pessoas entram/saem (eventos entrada/saida), o app mostra o
   selo "N pessoas" sobre a imagem daquela área. Sem terminal vinculado,
   nenhum selo aparece.

## Cálculo
Para cada pessoa, entre os terminais da área, o último evento entrada/saída
do dia define se está dentro. Contagem = pessoas cujo último evento = entrada.
Eventos de dias anteriores não contam (reset à meia-noite), evitando que uma
entrada sem baixa fique "presa".
