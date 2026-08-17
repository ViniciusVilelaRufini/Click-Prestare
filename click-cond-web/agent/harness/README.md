# Harness de verificação do Agente Local

Roda o **agente de verdade** contra aparelhos simulados que falam os protocolos
reais, sem precisar de hardware na mesa.

```bash
node agent/harness/run.js
```

Saída: uma lista `PASS`/`FALHA` e o total. Sai com código 1 se algo falhar.

## O que ele sobe

| Peça | O que simula |
|---|---|
| `mock-device.js` → `servidorHik` | Hikvision ISAPI. **Valida o Digest de verdade**: header mal montado, senha errada ou `uri` que não bate com a rota são recusados. Também recusa multipart incompleto no cadastro de rosto e cadastro duplicado (forçando o caminho de `Modify`). |
| `mock-device.js` → `servidorControlId` | Control iD `.fcgi`. Toda rota exige sessão válida — prova que o cliente faz login antes de operar. |
| `mock-device.js` → `servidorDahua` | Intelbras/Dahua: login RPC2 em 2 etapas (desafio + hash MD5 maiúsculo), cgi `AccessUser`/`AccessFace`, `RPC2`, `recordFinder` (log em INI) e a stream `eventManager`. |
| `run.js` → nuvem falsa | Os endpoints que o agente consome: `poll`, `result`, `event`, `device-status`. |

O agente roda a partir de uma **cópia** em `.tmp-agent/` (gerada a cada
execução): ele grava marca d'água e fila offline ao lado do `index.js`, e um
teste nunca pode sobrescrever o estado do agente real desta máquina. O log do
processo fica em `.tmp-agent/agent-log.txt` — é o primeiro lugar a olhar quando
algo falha.

## O que está coberto

- **Comandos** nas três marcas: cadastro com rosto, re-cadastro (o caminho que
  trava se o aparelho recusar duplicado), listagem, remoção em lote, abrir
  porta, snapshot, ping.
- **Eventos ao vivo** nas três marcas, incluindo um acesso **isolado** — se o
  parser depender do boundary seguinte, o acesso só subiria quando a próxima
  pessoa passasse.
- **Formato XML** da Hikvision, que é o padrão de fábrica do firmware.
- **Varredura de fantasmas**: usuário criado no aparelho pelo instalador não
  pode ser listado (e portanto apagado) — isso o trancaria para fora.
- **Aparelho cai e volta**: replay do log interno, com a tentativa negada no
  aparelho (`ErrorCode != 0`) não virando acesso e o histórico anterior à marca
  d'água não sendo reprocessado.
- **Internet cai e volta**: o acesso é guardado em disco e reenviado.

## O que ele NÃO prova

Os aparelhos simulados seguem a **documentação** dos fabricantes. Se um firmware
específico divergir da doc (nome de campo, formato de data, paginação), o
harness passa e o hardware falha. Ele elimina os erros de lógica nossa — não a
divergência de firmware. No primeiro teste em campo, logue o corpo cru que o
aparelho manda antes de ajustar qualquer coisa.
