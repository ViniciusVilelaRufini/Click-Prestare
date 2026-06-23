# Guia de Implantação — Controle de Acesso (Facial / Botoeira / Catraca / Leitores)

Passo a passo para instalar o sistema na portaria de um condomínio e integrar
com os dispositivos físicos. Para gerar a versão em PDF deste guia:
`node docs/gerar-guia-pdf.mjs` (a partir de `click-cond-web/`).

---

## 1. Como o sistema conversa com os aparelhos (leia antes)

O sistema web roda na **nuvem** (o navegador é só a tela). Os aparelhos ficam
na **rede local do condomínio**, com IP privado (ex.: 192.168.1.50). Existem
dois sentidos de comunicação:

- **Evento sobe (aparelho → nuvem):** o facial/leitor ENVIA o acesso para a
  URL de webhook pela internet. É o que alimenta a aba **Eventos**, registra
  entrada/baixa e dispara o push no app. NÃO precisa de agente.
- **Comando desce (nuvem → aparelho):** cadastrar rosto, testar conexão, abrir
  porta. A nuvem NÃO alcança o IP privado da LAN — quem faz essa ponte é o
  **Agente Local** (um programa que roda num PC da portaria).

Resumo: a nuvem não "puxa" dos aparelhos pelo switch. Os aparelhos mandam
eventos para cima, e o Agente Local leva os comandos para baixo.

---

## FASE 0 — Antes de sair (preparação)

- Gere o executável do agente (uma vez): em `click-cond-web/agent/` rode
  `npm run build:exe`. Leve no pendrive: `click-agent.exe`, `.env.example` e
  `install-windows.bat`.
- Tenha em mãos: login do portal, IPs e credenciais (usuário/senha da API) de
  cada aparelho, e a URL da API na nuvem.
- Tenha as fotos dos moradores (ou já cadastradas no sistema).

## FASE 1 — Rede física

1. Ligue os aparelhos (facial, botoeira, catraca, leitores) no switch e no
   roteador.
2. Confirme que o roteador tem internet (os aparelhos mandam eventos pra nuvem).
3. Dê IP fixo a cada aparelho (reserva de DHCP no roteador ou IP estático no
   aparelho). Sem isso o IP muda e quebra a ligação.
4. Anote IP, porta, usuário e senha da API de cada aparelho.
5. Escolha o PC da portaria (sempre ligado, mesma rede) — é onde o agente roda.

## FASE 2 — Cadastro no sistema web

6. Acesse o portal e faça login.
7. Registre o condomínio, blocos e apartamentos.
8. Cadastre os moradores COM FOTO. A foto é o que o facial reconhece — sem
   foto, não há reconhecimento.

## FASE 3 — Cadastrar os dispositivos no portal

Em "Terminais de Dispositivos" -> "Novo Dispositivo", para cada aparelho:

9. Escolha o Tipo: Terminal Facial, Botoeira Relé IP, Catraca Eletrônica IP,
   Leitor de Tags RFID ou Leitor de QR Code.
10. Preencha IP, porta, fabricante e usuário/senha da API.
11. Sentido (facial/catraca/leitor): Entrada, Saída ou Automático. Para baixa
    por facial, cadastre um terminal de saída com Sentido = Saída.
12. Salve. O sistema gera o token / URL de webhook do aparelho.

## FASE 4 — Configurar cada aparelho (no próprio aparelho)

13. Faciais e leitores: aponte o "envio de eventos / monitor / push" do
    aparelho para a URL do webhook (botão "Copiar URL Webhook" no portal). É o
    que faz entrada/saída/baixa subirem para a aba Eventos e o push no app.
14. Control iD: habilite a API REST / monitor e use o usuário/senha da API
    (não só a senha da tela).
15. Botoeira/catraca: são apenas acionadores. Não têm webhook nem cadastro de
    rosto — só precisam do IP.

## FASE 5 — Instalar o Agente Local (PC da portaria)

16. Copie para o PC: click-agent.exe, .env e install-windows.bat.
17. No .env preencha: API_URL (URL da nuvem) e DEVICE_TOKENS (tokens dos
    aparelhos, separados por vírgula — o token é o final da URL do webhook).
18. Rode install-windows.bat como Administrador (inicia junto com o Windows),
    ou dê dois cliques no .exe para testar na hora.
19. No portal, o card de cada aparelho deve mostrar "Agente conectado".

## FASE 6 — Enviar os rostos para os faciais

20. Quando o agente conecta, o sistema já empurra os rostos pendentes sozinho
    (back-fill automático).
21. Para forçar/garantir, clique "Sincronizar rostos" na tela de Terminais.
    Acompanhe o painel: enviados / pendentes / erro.
22. Leitores RFID/QR: cadastre as credenciais com a captura guiada (apresente o
    crachá no leitor e o sistema captura o UID).

## FASE 7 — Testes e go-live

23. "Testar Conexão" em cada aparelho deve ficar Online.
24. Botoeira/Catraca: "Acionar Abertura" abre a porta/catraca.
25. Facial: um morador cadastrado chega, é reconhecido, a porta abre e o
    acesso aparece na aba Eventos + push no app.
26. Leitor + botoeira: passa o crachá, o sistema identifica e aciona a botoeira
    automaticamente (ponte leitor -> relé).
27. Saída/baixa: teste no terminal de saída (Sentido = Saída) — o visitante
    recebe baixa e sai da lista de "no local".

---

## Quem faz o quê (por tipo de dispositivo)

| Dispositivo | Precisa rosto? | Precisa webhook? | Como abre |
| --- | --- | --- | --- |
| Facial | Sim (sync) | Sim (eventos) | Reconhece e abre sozinho |
| Botoeira | Não | Não | Acionada pelo sistema/agente |
| Catraca | Não | Não | Acionada pelo sistema/agente |
| Leitor RFID/QR | Não (credencial) | Sim | Lê -> sistema valida -> aciona relé |

## Solução de problemas (rápido)

| Sintoma | Causa provável |
| --- | --- |
| Card "Sem agente" | Agente parado / .env errado / PC sem rede |
| "Testar Conexão" Offline | IP/porta/credencial errados ou aparelho fora da rede |
| Facial não reconhece | Rosto não sincronizado ou morador sem foto |
| Evento não aparece | Webhook não configurado no aparelho / sem internet |
| Baixa não acontece | Terminal de saída sem Sentido = Saída |
| "Acionar" falha | Fabricante sem suporte HTTP (zkteco/topdata/henry) -> use botoeira genérica |

---

## Anexo — Por que o Agente Local (executável) e alternativas

**Por que existe:** uma página web servida da nuvem (HTTPS) não consegue falar
com um aparelho em IP privado da LAN — nem o servidor na nuvem (não roteia IP
privado), nem o navegador (bloqueia HTTP da LAN a partir de página HTTPS). Para
a nuvem mandar comando ao aparelho, algo precisa estar dentro da rede fazendo a
ponte. O Agente é a menor peça possível para isso, e conecta só para fora (não
exige liberar porta no roteador).

**Dá para não rodar nada?** Depende do que você quer:

- Só EVENTOS (sem agente): o aparelho reconhece e abre sozinho, e manda os
  eventos para a nuvem (webhook). A aba Eventos, entrada/baixa e push no app
  funcionam SEM agente. O que se perde: cadastrar rosto pelo portal e acionar
  remotamente — o cadastro passa a ser feito na tela do próprio aparelho.
- Experiência COMPLETA pelo portal (cadastrar do web/app, testar, abrir): exige
  o Agente. Mas ele é instalado uma vez e roda sozinho com o Windows — não é
  "rodar algo toda vez".

**Futuro (sem agente, com cadastro pelo portal):** alguns aparelhos (ex.:
Control iD em modo push) conectam para fora por conta própria. Se o backend
implementar o protocolo push desse fabricante, o aparelho fala direto com a
nuvem e o agente deixa de ser necessário — porém é específico por fabricante e
ainda não está implementado.
