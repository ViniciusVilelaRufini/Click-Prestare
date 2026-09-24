# Agente Local — Etapa 3: descoberta na rede e correção automática de IP

Data: 2026-09-24 · Status: aprovado pelo usuário (desenho em conversa + 3 decisões abaixo)

## Objetivo

O agente acha sozinho os aparelhos de controle de acesso da rede do condomínio e o portal os
oferece para cadastro já preenchidos. Quando um aparelho cadastrado muda de IP (DHCP), o
agente o reencontra pelo MAC e a nuvem corrige o cadastro sozinha.

## Decisões do usuário

1. **Sugere, operador confirma.** Nada é cadastrado automaticamente e **nenhuma senha é
   testada** (faciais Intelbras bloqueiam o login após ~5 senhas erradas). O operador clica em
   Cadastrar, informa nome e senha; o resto vem preenchido.
2. **IP mudou → corrige sozinho**, identificando o aparelho pelo MAC (e série quando houver),
   com registro na auditoria.
3. **Marcas:** Intelbras/Dahua (validado em campo), Hikvision e Control iD (pela documentação,
   marcados "não validado em campo" no código e no portal).

## Fatos confirmados em campo (sonda de 24/09 no SS 3530 MF FACE W)

Pacote DHIP multicast `239.255.255.251:37810` (e broadcast `255.255.255.255:37810`): cabeçalho
de 32 bytes (`20 00 00 00` + `DHIP`, tamanho do JSON little-endian nos offsets 16 e 24) + JSON
`{"method":"DHDiscover.search","params":{"mac":"","uni":1}}`. Resposta (UDP de volta para a
porta de origem), JSON após o cabeçalho:

```json
{"mac":"b4:4c:3b:f4:e3:01","method":"client.notifyDevInfo","params":{"deviceInfo":{
 "DeviceClass":"BSC","DeviceType":"SS 3530 MF FACE W","HttpPort":80,
 "IPv4Address":{"DhcpEnable":true,"IPAddress":"192.168.3.175","SubnetMask":"255.255.255.0"},
 "Manufacturer":"Intelbras","SerialNo":"K3LJ3400209RH","Vendor":"Intelbras",
 "Version":"2.000.00IB004.0.R", ...}}}
```

O facial do teste está em **DHCP** — o cenário de IP que muda é real.

## Arquitetura

Só o agente enxerga a LAN: a busca mora no agente; a nuvem casa o resultado com os cadastros,
corrige IPs e expõe ao portal.

### Agente — `agent/src/descoberta/`

- `dahua.js` — monta o pacote DHIP e interpreta a resposta → `Achado`.
- `hikvision.js` — SADP: XML `<Probe><Uuid>…</Uuid><Types>inquiry</Types></Probe>` para
  `239.255.255.250:37020`; interpreta `ProbeMatch` (`DeviceType`, `DeviceSN`, `MAC`,
  `IPv4Address`, `HttpPort`). Não validado em campo.
- `controlid.js` — sem protocolo de descoberta: GET `http://ip:80/` com timeout curto nos
  hosts da(s) sub-rede(s) /24 local(is) (concorrência limitada); reconhece a página do Control
  iD. Não validado em campo.
- `arp.js` — lê `arp -a` (Windows) para obter o MAC de um IP; é a identidade universal.
- `index.js` (orquestrador) — `descobrir({ varredura })`: envia multicast/broadcast em cada
  interface IPv4 não interna, coleta respostas por ~3 s, opcionalmente roda a varredura HTTP,
  completa MACs pela ARP e **agrupa por MAC** (um aparelho que responde por dois protocolos vira
  um só). `Achado = { mac, ip, porta, fabricante: 'intelbras'|'hikvision'|'control_id', modelo,
  numero_serie, dhcp, validado_em_campo: boolean }`.
- Módulos puros (montar pacote, interpretar resposta, agrupar) sem rede — testáveis isolados.

Quando roda:
- na partida e a cada 5 min — só multicast (leve);
- quando a nuvem pede ("Procurar na rede" no portal) — multicast + varredura HTTP;
- quando um device cadastrado fica offline há mais de 2 min — multicast + varredura (acha o IP
  novo); no máximo 1 varredura a cada 10 min.

Envio: `POST /api/facial/agent/condo/:token/descobertos` com `{ achados: Achado[] }`, e o MAC
dos devices cadastrados que estão online (lido da ARP pelo IP cadastrado) para preencher `mac`
de quem ainda não tem.

### Nuvem (API NestJS)

- **Migração:** `Facial_Devices` ganha `mac VARCHAR(17) NULL` e `numero_serie VARCHAR(64) NULL`
  (aplicar o SQL no RDS antes do push; schema.prisma atualizado junto).
- `POST facial/agent/condo/:token/descobertos` (@Public, token do condomínio): sanitiza a
  entrada (mesmo padrão de `sanitizarTelemetria`: tipos, tamanhos, limite de itens, MAC/IP
  válidos), guarda em memória por condomínio (efêmero, como a telemetria) e:
  - **aprende MAC:** device do condomínio sem `mac` cujo IP bate com um achado → grava `mac` e
    `numero_serie`;
  - **corrige IP:** achado cujo MAC é de um device do condomínio com IP diferente → atualiza
    `ip`/`porta`, AuditLog `DISPOSITIVO_IP_CORRIGIDO` (de/para) e guarda o aviso para o portal.
    Só dentro do mesmo condomínio; nunca mexe em device de outro condomínio.
- Poll do condomínio devolve `descobrir: true` enquanto houver pedido pendente do portal (limpa
  ao receber o próximo `descobertos`).
- Portal (operador, isolado por condomínio):
  - `GET condominios/:id/facial/descobertos` → achados com `cadastrado` (id do device casado por
    MAC ou IP) e os avisos de IP corrigido recentes;
  - `POST condominios/:id/facial/descobertos/procurar` → marca o pedido.

### Portal (tela Terminais)

- Seção **"Encontrados na rede"**: marca, modelo, IP, "já cadastrado ✓" ou botão **Cadastrar**;
  selo "não validado em campo" para Hikvision/Control iD; botão **Procurar na rede** e "última
  busca há X".
- **Cadastrar** abre "Novo Dispositivo" preenchido (fabricante, modelo, IP, porta, MAC, série);
  o operador informa nome e senha; o fluxo de salvar existente continua (teste de conexão e
  carga de pessoas).
- Aviso de IP corrigido: "IP do <nome> atualizado de A para B às HH:MM".

## Segurança

- A descoberta só lê: nenhuma credencial é enviada a aparelho achado.
- Entrada do agente tratada como não confiável (sanitização, limites) — rota pública por token.
- Correção de IP restrita ao condomínio do token, casada por MAC exato; auditada.
- Varredura HTTP só em /24 das interfaces locais, só porta 80, concorrência e frequência
  limitadas.

## Fora do escopo

Cadastro automático, teste de senha padrão, configuração do aparelho (etapa 2), LPR/antenas/
centrais (etapas 4–6), sub-redes que não sejam a do PC do agente.

## Testes

- Agente (`node --test`): montar/interpretar DHIP (com a resposta real acima), SADP, página
  Control iD, `arp -a`, agrupamento por MAC.
- Harness: aparelho simulado responde DHIP; achado chega à nuvem simulada; device que "muda de
  IP" é reencontrado.
- API (jest): sanitização, aprende MAC, corrige IP (e não corrige em outro condomínio), flag
  `descobrir` no poll, isolamento dos endpoints do portal.
- Portal (jest): seção renderiza achados, Cadastrar preenche o formulário, botão Procurar.
- Em campo: facial Intelbras do usuário aparece em "Encontrados" como já cadastrado; trocar o IP
  dele (ou reservar outro no roteador) e ver o cadastro corrigido.
