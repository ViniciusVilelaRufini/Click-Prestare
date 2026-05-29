# 🏛️ Arquitetura — Click Portaria

Documento curto explicando decisões não-óbvias do sistema, pra você (ou outro dev) não se perder no futuro.

---

## ⚠️ Visitantes ≠ Pessoa — a decisão mais importante

### O conceito real

**A tabela `Visitantes` no banco não representa "uma pessoa".** Ela representa **"uma autorização para uma visita específica"**.

Quando o porteiro cadastra "Rodrigo no Apto 101" e depois "Rodrigo no Apto 202", o banco fica com **2 linhas** — uma por autorização, não por pessoa.

### Por que ficou assim?

Histórico do projeto: a tabela foi criada antes do produto ter o conceito de "pessoa recorrente". Quando aparecemos com integração facial (Sprint 1) e RFID (depois), a tabela `Visitantes` já tinha 64+ registros em produção. Refatorar pra `Pessoas` + `Visitas` separadas seria 16-20h de trabalho com alto risco de regressão.

**Decisão:** manter a tabela como está (cada linha = uma visita) e **agregar virtualmente** no backend.

### Como o sistema esconde isso do usuário

A UI mostra "1 pessoa = 1 linha" via:

1. **Backend:** `VisitantesService.listarPessoas()` faz `GROUP BY documento` em memória, escolhe o "registro principal" (priorizando quem está no condomínio agora) e agrega contadores (`totalVisitas`, `apartamentosVisitados`).
2. **Frontend:** componente `/visitantes` consome `GET /condominios/:id/visitantes/pessoas` (não o `GET /visitantes` plano).
3. **Reutilização de identidade:** quando o porteiro cadastra alguém com CPF já existente, `create()` automaticamente herda `foto_pessoa`, `foto_documento` e `face_id` do registro mais sincronizado anterior. Isso garante que **o terminal facial enxerga 1 Rodrigo**, não vários.

### Limites dessa abordagem

- Aguenta tranquilo até **~5.000 pessoas por condomínio**. Acima disso, o `GROUP BY` em memória vira gargalo.
- Quando crescer, refatorar pra `Pessoas` + `Visitas` separadas (plano descrito em `FACIAL_INTEGRATION_PLAN.md`).

### Como o índice ajuda

O índice composto `(id_condominio, doc_identificacao)` em `Visitantes` (commit dessa refatoração) acelera:
- `listarPessoas()` — agrupamento por doc num só condomínio
- `buscarPessoa()` — banner "pessoa já cadastrada" no form
- Estende o limite prático antes do gargalo aparecer

---

## 📋 Endpoints de Visitantes — quando usar cada

### `VisitantesController` (`/condominios/:id/visitantes/*`)
Usado pelo **portal web** principalmente.

| Endpoint | Quando usar |
| --- | --- |
| `GET /pessoas` ⭐ | Lista da página `/visitantes` — **sempre prefira este** |
| `GET /` | Lista bruta (cada linha = uma visita). Só pra **pickers** (prestadores, simulador). NÃO usar na UI principal. |
| `GET /:id/detalhes` | Modal de detalhes com timeline completa de acessos |
| `GET /buscar/pessoa` | Banner "pessoa já cadastrada" no form (lookup por documento) |
| `POST /` | Cadastrar pessoa nova (1ª visita) |
| `POST /pessoa/:idRef/nova-visita` ⭐ | Cadastrar nova visita de pessoa existente (reutiliza foto/face_id) |
| `PUT /pessoa/:idRef` ⭐ | Editar identidade da pessoa (propaga pra todas as visitas dela) |
| `DELETE /pessoa/:idRef` ⭐ | Remover pessoa inteira (todas as visitas + desinscreve do terminal facial) |

### `VisitantesGlobalController` (`/visitantes/*`)
Usado principalmente pelo **app Flutter** (rotas legacy).

| Endpoint | Quem usa |
| --- | --- |
| `GET /get-all` | Flutter: lista visitantes do morador logado |
| `POST /insert` | Flutter: cadastrar visita |
| `POST /update` | Flutter: editar visita |
| `GET /validar/:codigo` | Portal: validação de PIN na portaria |
| `POST /check-in` / `check-out` / `liberar` | Portal + Flutter: controle de acesso |

**Por que não migrar o Flutter pros endpoints novos?** Já está na Play Store em v1.0.0+16. Atualizar o app exige nova release, que demora ~24h pra revisão. Os endpoints legacy continuam funcionando bem.

---

## 🎯 Quando ESCALAR pra refatoração estrutural

Faça `Pessoas` + `Visitas` separadas quando alguma dessas for verdade:

- Mais de **5.000 pessoas por condomínio** (consulta de `/pessoas` ficar lenta)
- Precisar de **histórico cronológico por pessoa** que não cabe nas tabelas atuais (ex: pessoa muda de CPF, mudança de nome legal)
- Quiser **adicionar relações complexas** (ex: lista de telefones por pessoa, endereços, vinculações com várias empresas)

Plano detalhado em `FACIAL_INTEGRATION_PLAN.md` (sprint 7+).

---

## 🔗 Outros documentos

- [`FACIAL_INTEGRATION_PLAN.md`](FACIAL_INTEGRATION_PLAN.md) — plano original de integração facial
- [`FACIAL_INTEGRATION_CHANGES.md`](FACIAL_INTEGRATION_CHANGES.md) — o que foi feito em cada sprint
- [`FACIAL_SIMULATOR_GUIDE.md`](FACIAL_SIMULATOR_GUIDE.md) — como usar o simulador facial
- [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) — como deploy (Vercel/Railway) e ambiente local
