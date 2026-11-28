# Portaria autônoma — desenho

Data: 28/11/2026. Dono do produto: Vinicius. Worktree `C:/w/interfone`.

## Intenção

O Prestare hoje é uma ferramenta **para o porteiro**. O dono quer que o sistema também sirva a condomínios **sem porteiro** (portaria autônoma) e ao modelo **misto** (porteiro em parte do dia, remoto no resto), sem perder o que já funciona.

Em portaria autônoma, tudo que hoje depende de alguém na guarita precisa de outro caminho: o visitante que o morador não atende, o pânico, o portão forçado, a encomenda. A peça central é **quem responde quando ninguém responde**.

## Decisões do dono

- **Central remota da própria Prestare, 24h** (opção A): operadores contratados pela Prestare atendem vários condomínios.
- **IA de voz atende o visitante** quando o morador não atende, antes do operador humano.
- **A IA só conversa, nunca abre o portão.** Ela coleta, avisa o morador e encaminha. O portão abre apenas por prova objetiva já existente no sistema: PIN/QR de convite, código de entrega, **autorização do morador no app** ou **decisão do operador**.
- O dono delegou as demais escolhas ("faça tudo o que você recomendar"). Elas estão marcadas como **escolha minha** abaixo.

## Metas, não-metas e anti-metas

**Metas**
- O visitante nunca fica sem resposta num condomínio autônomo.
- Pânico e alertas de portão chegam a um humano 24h.
- O mesmo condomínio pode ser local, remoto ou misto, por horário.
- O operador da central atende vários condomínios numa tela só.

**Não-metas (desta fase)**
- A IA abrir portão ou "decidir" acesso.
- Análise de vídeo (detecção de pessoas, carona por câmera).
- Trocar o hardware de acesso existente.

**Anti-metas (seria um fracasso mesmo funcionando)**
- A IA revelar dados de moradores ("o João mora no 106?", "ele está em casa?").
- Alguma abertura de portão sem registro auditável de quem decidiu.
- O operador afogado em ruído (chamadas que a IA ou o morador já resolveram).
- O sistema fora do ar deixar o condomínio sem acesso de moradores (o facial precisa continuar abrindo sozinho, como hoje).

## O programa (sete frentes) e a ordem

| # | Frente | Depende de | Observação |
|---|---|---|---|
| 1 | **Central remota + agenda + IA no portão** | — | Esta fase. Detalhada abaixo. |
| 2 | **Confiabilidade** (alta disponibilidade, alertas a quem atende) | 1 | Custos de AWS a aprovar. |
| 3 | **iPhone no interfone** (CallKit/PushKit) | — | Código pronto, nunca compilado. Precisa do "TestFlight" do dono. |
| 4 | **Segurança física** (portão aberto/forçado, coação) | 1 | Eventos do facial e do Guarita para a central. |
| 5 | **Morador sem app** (tocar no telefone comum) | 1 | Precisa contratar tronco SIP com número brasileiro. |
| 6 | **Encomendas sem porteiro** (armário inteligente) | 1 | Precisa escolher o fornecedor do armário. |
| 7 | **Testes em campo** (bancada de cada frente) | todas | Roteiro por frente. |

Cada frente vira um desenho/plano próprio quando chegar a vez. As frentes 2 a 7 têm só o rumo aqui (seção "Próximas frentes").

---

## Fase 1 — Central remota, agenda e IA no portão

### 1. Modo de operação por condomínio (agenda)

**Escolha minha: agenda por condomínio, com salvaguarda por presença.**

- Nova coluna `Condominios.central_contratada` (0/1): a Prestare marca no CRM, como já faz com `interfone_contratado`.
- Nova coluna `Condominios.ia_portao_ativa` (0/1), também no CRM.
- Nova tabela `Portaria_Agenda`: `id`, `id_condominio`, `dia_semana` (0=domingo…6), `inicio` (HH:MM), `fim` (HH:MM), `destino` (`'local'` | `'central'`). Faixas não podem se sobrepor no mesmo dia; `fim` pode ser `24:00`. Faixa que cruza a meia-noite é cadastrada como duas.
- **Sem linhas na agenda = `local`** (comportamento de hoje). Condomínio sem `central_contratada` é sempre `local`, mesmo com agenda.
- Função única na API, `destinoPortaria(idCondominio, agora)`, hora de Brasília:
  1. Sem central contratada → `local`.
  2. Faixa da agenda diz `central` → `central`.
  3. Faixa diz `local` (ou não há faixa), mas **nenhum porteiro conectado** naquele condomínio → `central` (salvaguarda).
  4. Senão → `local`.
- **Quem configura:** Prestare, no CRM (aba Interfone ganha "Central contratada", "IA no portão" e a agenda). O síndico **vê** a agenda no console (Configurações → Interfone), só leitura. Motivo: é serviço contratado e muda a operação da central.

### 2. Fluxo da chamada do facial

Hoje (facial → unidade): toca o morador `toque_apto_s` (30 s); ninguém atende → se `interfone_transferir` e há porteiro online, toca no console do prédio por `toque_portaria_s` (45 s); senão "ninguém atendeu".

Novo, quando o morador não atende (`toqueEsgotado` na API):

```
destino = destinoPortaria(condomínio)
local   → como hoje (console do prédio)
central → se ia_portao_ativa: IA atende o visitante
              ├─ morador autorizou no app → portão abre (pelo caminho já existente)
              ├─ IA chama transferir_central → toca na central
              └─ IA encerra (visitante foi embora, resolvido, ou sem resposta)
          senão: toca direto na central
central sem operador conectado → IA (se ativa) e depois "ninguém atendeu"; registra alerta
```

- **O visitante que chama a portaria.** Novo tipo de chamada `facial_portaria`: o visitante digita o **número da portaria** no teclado do facial (campo novo `Condominios.interfone_numero_portaria`, padrão `0`). Vai direto ao destino (console do prédio, IA ou central), sem tocar morador. A IA pergunta a unidade e usa `avisar_morador`. A IA pode tocar o morador (`chamar_morador`) ou mandar o pedido por push.
- **Convivência (escolha minha):**
  - Em horário `central` com porteiro ainda conectado no prédio: toca **nos dois** (console do prédio e central); quem atender primeiro leva.
  - Com `central_contratada`, a transferência quando ninguém atende passa a ser **sempre ligada** (o ajuste "Transferir para a portaria" do síndico fica travado e explicado: "incluído no contrato da central"). Sem central, segue a escolha do síndico como hoje.
  - `central_contratada` só pode ser ligada no CRM se `interfone_contratado` estiver ligado; a chamada só flui com `interfone_ativo`.
  - Todos os moradores recusarem conta como "não atendeu": segue o mesmo destino.
- A chamada que vai para a central fica tocando para **todos os operadores conectados**; quem atender primeiro leva (mesma regra do console hoje).
- Novo resultado em `Interfone_Chamadas.resultado`: `atendida_central`, `atendida_ia` (IA resolveu sem humano), e `atendida_por_tipo` ganha `'central'`.

### 3. A IA no portão

**Escolha minha: Amazon Nova 2 Sonic (fala ↔ fala) no Bedrock**, modelo `amazon.nova-2-sonic-v1:0`, voz brasileira (`carolina`). Ele responde em menos de um segundo, aceita interrupção e chama ferramentas. Só existe em `us-east-1`, `us-west-2` e Tóquio: usar `us-east-1`. A alternativa (Transcribe em São Paulo + modelo de texto + Polly) fica como **plano B** se a qualidade em português não servir; ela custa 2 a 3 s de espera por fala.

**Primeiro uma prova (escolha minha).** Antes de construir o resto da IA, uma prova curta no `voz`: externalMedia → Nova 2 Sonic → volta, conversando com o facial de bancada. O dono ouve e aprova a qualidade da voz e do entendimento em português. Se não servir, troca para o plano B. O `agente-ia` tem uma interface de "motor de voz" para os dois caberem, mas só o Nova 2 Sonic é implementado agora. Uso do Bedrock (habilitar o modelo em `us-east-1`) está autorizado pelo dono ("pode utilizar a API de IA"); o custo por minuto é medido na prova e informado antes de ligar para cliente.

**Onde roda:** dentro do serviço `voz` (EC2 da central de voz), novo módulo `agente-ia`.
- O Asterisk manda o áudio do visitante por **externalMedia** da ARI (RTP, `slin16`) para uma porta UDP local do serviço; o serviço reamostra, envia ao Nova 2 Sonic por stream bidirecional (`InvokeModelWithBidirectionalStream`) e devolve a voz da IA pelo mesmo canal.
- O vídeo do facial continua indo à gravação/foto como hoje; a IA só ouve.
- Permissão nova no papel da EC2: `bedrock:InvokeModelWithBidirectionalStream` no modelo em `us-east-1` (e habilitar o acesso ao modelo no console do Bedrock).

**Ferramentas da IA** (não há ferramenta de portão):

| Ferramenta | O que faz |
|---|---|
| `identificar_unidade(texto)` | Resolve "bloco A 106" para a unidade do condomínio. Responde só se existe, nunca quem mora. |
| `avisar_morador(nome, motivo, tipo)` | Cria o pedido de autorização (reuso da portaria remota: `Visitantes` com `auth_status='pendente'`, push `autorizacao_visitante` com a foto do facial e o resumo). |
| `situacao_do_pedido()` | Diz se o morador autorizou, negou ou não respondeu. |
| `transferir_central(motivo, urgente)` | Passa a chamada à central com o resumo. |
| `encerrar(resumo)` | Desliga com despedida e grava o resumo. |

**Pedido do portão (escolha minha, revisada depois da leitura do código).** O pedido que a IA cria **não** reaproveita o cadastro de visitante (`Pessoas`/`Visitas`): lá, autorizar dá `liberado=1`, uma janela de 4 h e cadastra o rosto no facial. Isso é acesso duradouro concedido a quem só disse um nome, risco de engenharia social. Em vez disso:
- Nova tabela `Interfone_Pedidos` (`id`, `id_chamada`, `id_condominio`, `id_apartamento`, `nome_falado`, `motivo`, `tipo` = `visita`|`entrega`|`servico`|`outro`, `foto`, `estado` = `pendente`|`autorizado`|`negado`|`expirado`, `respondido_por`, `respondido_em`, `created_at`).
- Push novo `interfone_pedido` para os moradores da unidade, com foto, nome falado e motivo; no app, **Autorizar** / **Negar** (tela própria do interfone, ao lado do card da chamada).
- **Autorizar abre o portão uma única vez**: o do facial de onde veio a chamada, pelo caminho do "Abrir portão" do interfone (agente → relé, DTMF de reserva), se a chamada ainda está ativa ou terminou há até 5 min. Depois disso o pedido expira e autorizar não abre mais nada. Não cria visitante, não libera PIN nem rosto.
- Registro: "aberto por autorização do morador <nome> (pedido do interfone)". O pedido aparece no histórico da chamada.
- Entregas usam o mesmo pedido (tipo `entrega`); a IA antes orienta conforme `instrucao_entregas`. O módulo Delivery (PIN do morador) continua valendo à parte.
- Isso exige **versão nova do app** (Android e iPhone) para a tela de pedido.

**IA o mais inteligente possível (pedido do dono em 28/11: "eu quero o sistema mais inteligente possível").** Dentro da regra de nunca abrir, a IA ganha, além das ferramentas acima:

| Ferramenta / capacidade | O que faz |
|---|---|
| `chamar_morador()` | Toca o app dos moradores da unidade (como a chamada do interfone). Quem atende ouve a IA apresentar o visitante ("o entregador do Mercado Livre está no portão") e a IA sai: morador e visitante falam direto, com vídeo, e o morador abre pelo botão de sempre. |
| Resposta por mensagem | Na tela do pedido, o morador toca "Já desço", "Deixe na portaria", "Volte mais tarde" ou escreve um texto curto; a IA **fala** a resposta ao visitante (`situacao_do_pedido` passa a trazer a mensagem). |
| `esperados_hoje()` | Convites e entregas esperados hoje para a unidade. Com convite válido, a IA orienta a usar o QR/PIN no leitor; senão marca o pedido como "esperado"/"não esperado". Nunca lê a lista para o visitante. |
| Visitante frequente | O pedido traz "autorizado N vezes nos últimos 60 dias" quando nome e unidade batem com pedidos autorizados antes. |
| Visão da foto | A foto do facial passa pelo modelo de visão já usado na Prestare IA (Claude no Bedrock, `sa-east-1`): uniforme/mochila de entrega, quantas pessoas, rosto coberto. Vai no pedido ao morador e na tela do operador. **Só informa, nunca decide.** |
| `perguntar_condominio(pergunta)` | Responde dúvidas (horário de mudança, regras, onde deixar entregas) pela base RAG da Prestare IA com os documentos do condomínio. Nada de dados de moradores. |
| Idiomas | Atende em espanhol e inglês se o visitante falar (vozes poliglotas do Nova 2 Sonic). |
| Risco e urgência | Classifica a chamada (`normal`/`suspeita`/`urgente`): pedir dados de morador, insistir em entrar, contradições → `suspeita`; emergência → `urgente`. `suspeita` e `urgente` vão na hora ao operador com o motivo; o histórico guarda a classificação. |
| Resumo ao morador | Depois da chamada, o histórico do app mostra o resumo ("Carlos, Mercado Livre, deixou na portaria às 14:32"). |

Com `chamar_morador`, a IA pode tocar o celular do morador (isso não abre portão). Isso substitui a frase anterior de que a IA não tocava o morador.

**Instruções fixas da IA (prompt de sistema), escolha minha:**
- Apresenta-se: "Portaria virtual Prestare. Esta conversa é atendida por um assistente e pode ser registrada."
- Nunca confirma nomes, presença ou dados de moradores; nunca promete abrir.
- Entregas: segue o texto de orientação do condomínio (campo novo `Condominios.instrucao_entregas`, editável no CRM), por exemplo "deixe no armário" ou "o morador vai descer".
- Palavras de emergência (socorro, assalto, fogo, passando mal) → `transferir_central(urgente=true)` na hora.
- Limites: conversa de no máximo 3 min; 15 s de silêncio encerra; erro do Bedrock → vai direto à central (ou "ninguém atendeu").

**Privacidade (LGPD):** aviso falado no início; transcrição e resumo guardados 90 dias (mesma regra das fotos do interfone); a política de privacidade passa a citar o processamento de voz pela AWS nos EUA.

### 4. A central (operadores da Prestare)

**Escolha minha: login próprio de operador, no mesmo console web (`portaria-web`), em uma área "Central".**

- Nova tabela `Central_Operadores` (`id`, `nome`, `email`, `senha_hash`, `ativo`, `ultimo_acesso`), cadastrada no CRM por um admin. Login em `/central/login` com MFA por e-mail (mesmo padrão do síndico).
- Token com `papel: 'operador_central'` e **sem** `id_condominio`. Hoje o gateway em tempo real desconecta token sem condomínio: passa a aceitar esse papel e colocá-lo na sala `central`.
- O operador **não** vê telas administrativas de condomínio. Vê só a área Central:
  - **Fila** de chamadas tocando de todos os condomínios em modo central (nome do condomínio, unidade, portão, foto, resumo da IA, há quanto tempo).
  - **Atender**: mesma tela de chamada do console (vídeo, áudio, Abrir portão). Token de voz com `papel: 'central'`.
  - **Alertas** abertos de todos os condomínios (pânico, portão aberto/forçado quando vier a frente 4), com "visto por".
  - **Ligar para uma unidade** de qualquer condomínio coberto.
  - **Histórico** das chamadas da central (com transcrição da IA).
- **O que o operador vê ao atender (escolha minha, mínimo necessário pela LGPD):** condomínio, portão, unidade, resumo e transcrição da IA, estado do pedido ao morador, **convites e entregas esperados hoje para a unidade** (nome do visitante e horário), **primeiro nome dos moradores** da unidade e `instrucao_entregas`. Não vê telefone, documento nem e-mail de morador.
- **O que o operador pode fazer:** falar com o visitante; **pedir autorização ao morador** a partir da chamada (mesmo `Interfone_Pedidos`); ligar para a unidade (toca no app); **abrir o portão por decisão própria**, como o porteiro faz hoje, mas com **motivo obrigatório** (lista curta + texto), que vai para a auditoria.
- Toda ação do operador vai para a auditoria com o operador e o condomínio.

### 5. Tempo real em mais de uma máquina (pré-requisito)

A API pode rodar 2 instâncias (EB min 1, máx 2) e o Socket.IO **não** sincroniza entre elas: "porteiro online" e "tocar na central" falham quando o operador está na outra instância. A Fase 1 inclui o **adaptador Redis do Socket.IO** com um **ElastiCache Serverless (Valkey)** na mesma VPC. **Aprovado pelo dono em 28/11.** Criar na primeira etapa, junto com o código que o usa. A contagem "quem está online" passa a usar `fetchSockets()` com o adaptador (enxerga todas as instâncias).

### 5b. Pânico e alertas na Fase 1

A meta "pânico chega a um humano 24h" entra já: quando o Guarita grava um alerta (`criarAlerta`), a API passa a **emitir em tempo real** para a sala `central` (se o condomínio está em modo central naquela hora) e para a sala da portaria do prédio (hoje o console só consulta de tempos em tempos). Pânico toca alerta sonoro na tela da Central até alguém marcar "visto". Os eventos de porta do facial (frente 4) entram no mesmo canal quando vierem.

"Central sem operador conectado" na hora de uma chamada ou alerta: nesta fase gera **registro + métrica no CloudWatch**; o aviso a quem está de plantão (SMS/WhatsApp) é da frente 2.

### 6. Dados e migração

SQL aditivo (padrão do projeto: arquivo em `click-cond-web/prisma/sql/` + verificação, aplicado no RDS antes do deploy):
- `Condominios`: `central_contratada`, `ia_portao_ativa`, `instrucao_entregas` (TEXT).
- `Portaria_Agenda` (nova).
- `Central_Operadores` (nova).
- `Interfone_Chamadas`: `ia_resumo` (TEXT), `ia_transcricao` (MEDIUMTEXT), `id_operador_central`; novos valores aceitos em `resultado`/`atendida_por_tipo`.
- `Interfone_Pedidos` (nova; ver "Pedido do portão").
- `Condominios.interfone_numero_portaria` (VARCHAR(8), padrão `'0'`).
- `Interfone_Chamadas.tipo` aceita `facial_portaria`.

### 6b. Entrega em duas etapas (escolha minha)

Não há data nem cliente definido. Para reduzir risco, a Fase 1 sai em duas entregas, ambas desligadas por padrão (só ligam no CRM):
1. **Central humana:** Redis + adaptador, agenda, salvaguarda, login de operador, área Central (fila, atender, abrir com motivo, pedido ao morador, alertas em tempo real), `facial_portaria`, `Interfone_Pedidos` e a tela de pedido no app.
2. **IA no portão:** prova do Nova 2 Sonic (com aprovação do dono), depois o `agente-ia` completo.

### 7. Testes

- Unitários: `destinoPortaria` (agenda, meia-noite, salvaguarda, sem contrato), roteamento da chamada, ferramentas da IA (sem vazamento de dados de morador), autorizar-abre-portão (janela de 5 min, só a partir do interfone).
- Serviço `voz`: máquina de estados com o novo estado `ia`; agente IA com o Bedrock simulado.
- Bancada: facial SS 3530 → morador não atende → IA conversa → morador autoriza no emulador → portão abre; IA transfere → operador atende na Central.
- Teste de carga leve: 2 instâncias da API com o adaptador Redis, operador numa, chamada criada na outra.

### O que fica para quem constrói

- Formato exato das telas da Central (seguir o visual Prestare Dark do console).
- Reamostragem de áudio e tamanho dos pacotes no `agente-ia`.
- Texto final do prompt da IA (dentro das regras acima) e escolha entre as vozes pt-BR.
- Como mostrar a agenda no CRM (grade semanal ou lista de faixas).

---

## Próximas frentes (só o rumo)

**2. Confiabilidade.** RDS Multi-AZ; EB com mínimo de 2 instâncias (depois do adaptador Redis); alertas do CloudWatch indo para SMS/WhatsApp do plantão da central, não só e-mail; **chamada sintética** a cada 5 min (o `simular-facial.sh` vira verificação) com alerta se falhar; runbook de reconstrução da EC2 de voz a partir de imagem. Custos a aprovar.

**3. iPhone.** Compilar o código já escrito (CallKit/PushKit) no pipeline do iOS e testar com o facial. Upload ao TestFlight só quando o dono pedir.

**4. Segurança física.** O agente local passa a encaminhar os eventos de porta do facial que hoje descarta (porta aberta demais, arrombamento, entradas de alarme). Alertas do Guarita e do facial chegam à central em tempo real (hoje só ficam no banco e o console consulta). Coação: pesquisar o suporte de "senha de coação" nos faciais Intelbras/Hikvision; se não houver, PIN de coação no app. Carona depende de sensor físico; o software só recebe o evento.

**5. Morador sem app.** Tronco SIP com número brasileiro no Asterisk; a unidade ganha "telefone para o interfone" e toca nele depois (ou junto) do app. Precisa escolher e contratar a operadora.

**6. Encomendas.** Integração com armário inteligente: o entregador deposita, o morador recebe o código. Precisa escolher o fornecedor. Até lá, a IA usa o `instrucao_entregas` do condomínio.

**7. Testes em campo.** Roteiro de bancada por frente, incluindo o Guarita/Linear (publicado sem teste em aparelho).

## Abordagens consideradas

**Quem atende na central:** (A) operadores da Prestare — **escolhida pelo dono**; (B) empresa parceira usando o console; (C) sem central humana (síndico/zelador de plantão). O desenho do operador não depende de quem contrata, então B continua possível depois.

**Quando o condomínio é autônomo:** (A) chave liga/desliga; (B) agenda por condomínio — **escolhida**; (C) por presença de porteiro. A escolhida usa a presença como salvaguarda.

**Poder da IA:** (1) só conversa e encaminha — **escolhida pelo dono**; (2) abrir com regras; (3) decidir tudo (descartada: engenharia social).

**Motor de voz da IA:** Nova 2 Sonic fala↔fala — **escolhida**; Transcribe + modelo de texto + Polly — plano B (mais lento, fica no Brasil exceto o Polly).
