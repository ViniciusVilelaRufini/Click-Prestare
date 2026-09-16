# DPA do Vercel — situação e pontos para análise jurídica

Levantado em 11/09/2026. Documento irmão de `DPA_RAILWAY_PARA_ADVOGADA.md`.

O Vercel hospeda o frontend (painel web / portaria-web) do sistema Prestare e, pela
configuração atual, também atua como **proxy reverso de toda a API**.

## Documentos

| O quê | Onde |
|---|---|
| Texto do DPA | https://vercel.com/legal/dpa |
| Trust center / suboperadores | https://security.vercel.com |
| Termos de serviço | https://vercel.com/legal/terms |

## Como este DPA é celebrado

Diferente do Railway, **não há formulário a assinar**. O texto diz que "entering into
this Addendum will have the same effect as signing" — ele passa a valer automaticamente
com a aceitação dos Termos de Serviço.

**Porém:** o DPA se aplica apenas aos planos **Enterprise e Pro**.

> PENDÊNCIA — confirmar em Settings → Billing qual o plano da conta. Se for Hobby:
> (a) provavelmente não há DPA vigente; e
> (b) o Hobby veda uso comercial nos Termos de Serviço do Vercel, o que é um problema
> contratual autônomo, independente de proteção de dados.

## PONTO CRÍTICO — dado sensível é contratualmente proibido

O DPA do Vercel estabelece:

> "Customers are prohibited from including sensitive data or special categories of data
> in Customer Data."

Isso é mais grave que o caso do Railway. Lá o Exhibit A **descrevia** ausência de dado
sensível (descrição imprecisa). Aqui há **proibição contratual expressa**.

E a biometria efetivamente transita pelo Vercel. Ambos os `vercel.json` (raiz e
`click-cond-web/`) contêm:

```json
{ "source": "/api/:path*",
  "destination": "https://click-prestare-production.up.railway.app/api/:path*" }
```

Ou seja, o Vercel não serve apenas arquivos estáticos — ele intermedeia todas as chamadas
de API, terminando o TLS na sua edge e reencaminhando. E a portaria-web captura rosto por
webcam (`apps/portaria-web/src/app/shared/facial-capture.component.ts` e
`enroll-capture.component.ts`), enviando a imagem por `/api/*`.

Resultado: imagem facial — dado biométrico, sensível pelo art. 5º, II da LGPD — passa
por infraestrutura cujo contrato proíbe expressamente esse tipo de dado.

**Mitigação sugerida (técnica, de baixo custo):** remover o Vercel do caminho dos dados,
apontando as chamadas de API diretamente para o domínio do Railway em vez do rewrite —
ou, no mínimo, as rotas de captura e cadastro facial. Com isso o Vercel volta a ser
apenas CDN de conteúdo estático e a proibição deixa de ser tocada. É alteração de
configuração, não de arquitetura.

## Cláusulas relevantes

- **Papéis:** Cliente é controlador ou operador; Vercel é **operador** quanto a Customer
  Data e **controlador autônomo** quanto a Service-Generated Data e Contact Data.
- **Suboperadores:** lista em security.vercel.com. Janela de objeção de apenas
  **5 dias corridos** (o Railway dá 10). Não havendo acordo, a saída é rescisão por
  conveniência, **sem reembolso**.
- **Transferência internacional:** Cláusulas Contratuais Padrão da UE, módulos 1 a 3
  conforme os papéis; UK IDTA para o Reino Unido. SCCs regidas pela lei irlandesa; IDTA
  pela lei da Inglaterra e País de Gales. **Não há menção a certificação no Data Privacy
  Framework** — diferente do Railway. Nenhuma menção à LGPD ou às cláusulas da ANPD.
- **Segurança:** AES-256 em repouso, TLS 1.2+ em trânsito, infraestrutura sobre AWS,
  Azure e GCP, backups em múltiplas zonas de disponibilidade, SOC 2 Type 2 anual,
  treinamento anual obrigatório.
- **Incidentes:** notificação "without undue delay" a partir da confirmação. Atrasos
  determinados por autoridade policial não contam como demora indevida. Sem prazo fixo.
- **Auditoria:** satisfeita pela entrega do relatório SOC 2 Type 2 mais recente. **Não há
  direito de auditoria independente in loco** — o Railway concede esse direito (uma vez
  por ano, às custas do cliente). É um direito a menos.
- **Exclusão:** o cliente pode excluir ou exportar a qualquer momento; ao término, o
  Vercel exclui em prazo comercialmente razoável, salvo retenção exigida por lei.

## Comparativo com o Railway

| | Railway | Vercel |
|---|---|---|
| Forma de celebração | DocuSign assinado | Automática com os Termos |
| Planos cobertos | Qualquer | Só Pro e Enterprise |
| Dado sensível | Descrito como "None" | **Proibido** |
| Objeção a suboperador | 10 dias | 5 dias |
| Data Privacy Framework | Sim, quando aplicável | Não mencionado |
| Auditoria independente | Sim, 1x/ano, custo do cliente | Não — só relatório SOC 2 |
| Prazo de incidente | Sem demora indevida | Sem demora indevida |

## Pendências

1. Confirmar o plano da conta Vercel (Hobby x Pro x Enterprise).
2. Decidir sobre a retirada do Vercel do caminho da API — ao menos das rotas faciais.
3. Inscrever contato@prestaregestao.com.br nas notificações de suboperador em
   security.vercel.com. Atenção ao prazo de 5 dias.
4. Baixar e arquivar o relatório SOC 2 Type 2 mais recente, que é o instrumento que
   substitui o direito de auditoria.
