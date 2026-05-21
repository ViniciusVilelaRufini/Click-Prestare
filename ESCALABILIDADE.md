# Roadmap de Escalabilidade — Click Condomínios

## Estado atual (Maio 2026)

- **Frontend**: Vercel (Angular) — escala automaticamente, sem custo adicional
- **API**: Railway (NestJS) — plano atual, instância única
- **Banco**: MySQL no Railway — pool de 25 conexões
- **Rate limit**: 20 req/s (burst) + 600 req/min por IP

Capacidade estimada: **50–100 usuários simultâneos**.

---

## Fase 1 — Crescimento inicial (100–500 usuários)

**Quando fazer:** RAM da API no Railway ultrapassar 80% de forma consistente (verificar em Railway > Metrics).

### Railway
- Fazer upgrade do plano da API para **Hobby ($5/mês)** ou **Pro**
- Aumentar `connection_limit` de 25 para 40 na variável `DATABASE_URL`:
  ```
  ?connection_limit=40&pool_timeout=20
  ```

### Código
- Ativar cache Redis nas listagens mais acessadas:
  - Lista de moradores e apartamentos (TTL 5 min)
  - Áreas sociais e configurações do condomínio (TTL 15 min)
- O Redis já está no `docker-compose.yml`, só precisa ser conectado no código via `@nestjs/cache-manager`

---

## Fase 2 — Escala média (500–5000 usuários)

**Quando fazer:** tempo de resposta da API ultrapassar 800ms em média.

- Adicionar **Redis como serviço no Railway** (~$5/mês adicional)
- Mover envio de push notifications Firebase para fila assíncrona (**Bull + Redis**)
  - Hoje o Firebase é chamado de forma síncrona, bloqueando a resposta
- Aumentar `connection_limit` para 50
- Adicionar índices compostos no banco para queries de data:
  ```sql
  ALTER TABLE Visitantes ADD INDEX idx_cond_data (id_condominio, created_at);
  ALTER TABLE Encomendas ADD INDEX idx_cond_data (id_condominio, created_at);
  ALTER TABLE Comunicados ADD INDEX idx_cond_data (id_condominio, created_at);
  ```

---

## Fase 3 — Escala alta (5000+ usuários)

**Quando fazer:** múltiplos condomínios grandes ou centenas de condomínios ativos.

- Migrar banco MySQL para plano **dedicado no Railway** ou **PlanetScale**
- Configurar múltiplas instâncias da API no Railway (horizontal scaling)
- Separar banco em **leitura/escrita** (read replicas para dashboards e relatórios)
- Avaliar migração do banco para **PostgreSQL** (melhor suporte a conexões concorrentes que MySQL)

---

## Monitoramento

Verificar periodicamente em **Railway > Metrics** do serviço Click-Prestare:

| Métrica | Normal | Atenção | Crítico |
|---|---|---|---|
| RAM | < 60% | 60–80% | > 80% |
| CPU | < 40% | 40–70% | > 70% |
| Tempo de resposta | < 300ms | 300–800ms | > 800ms |

Quando qualquer métrica entrar em **Atenção** de forma consistente por mais de 1 dia, executar a próxima fase do roadmap.

---

## Variáveis de ambiente para atualizar no Railway ao escalar

```
# Fase 1
DATABASE_URL="...?connection_limit=40&pool_timeout=20"

# Fase 2
DATABASE_URL="...?connection_limit=50&pool_timeout=20"
REDIS_URL="redis://..."  # após adicionar Redis no Railway
```
