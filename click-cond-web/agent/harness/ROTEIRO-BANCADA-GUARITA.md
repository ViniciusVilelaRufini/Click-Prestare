# Roteiro de bancada — primeiro Módulo Guarita real

A integração com o Módulo Guarita (Nice / Linear-HCS) foi construída contra a documentação do
fabricante e um simulador. **Nenhum aparelho real respondeu a este código ainda.** Este roteiro é o
teste de verdade: faça-o num Guarita de bancada ou, se não houver, no primeiro cliente, com o
instalador presente e fora do horário de pico.

Regra geral: siga a ordem. Os passos 1 a 5 só leem ou acionam um relé; a gravação começa no passo 6.
Se um passo não der o resultado esperado, **pare** e registre o que aconteceu (texto do erro no
console e o trecho do log do agente, `agent-service.log`).

## Antes de começar

- Anote modelo e versão de firmware do Guarita (visor ou página web). Mínimo documentado: MG3000 VrG.003s.
- Faça o backup pelo próprio Guarita (cartão SD) ou pelo software da Nice. É a única restauração garantida.
- Confirme que nenhum outro programa fica conectado à porta de rede do Guarita o dia todo (software
  da Nice na portaria, empresa de monitoramento). Se ficar, peça ao instalador para habilitar a
  porta secundária e use-a no cadastro.
- Agente local atualizado para a versão que traz o driver do Guarita.
- Anote quantos dispositivos o visor do Guarita diz ter na memória.

## 1. Conectar e identificar

**Faça:** em Configurações, cadastre o aparelho "Módulo Guarita (Nice/Linear)" com IP, porta e a
palavra de autorização (se o Guarita tiver uma).

**Deve aparecer:** estado "Conectado", a versão de firmware e a diferença de relógio.

**Se não:**
- "Autorização negada": a palavra está errada (maiúsculas contam) ou o Guarita não tem palavra e o cadastro tem.
- "Sem resposta": IP/porta errados, outra conexão ocupando a porta, ou firewall.
- Conecta e cai a cada poucos segundos: anote; o driver derruba a conexão sempre que uma resposta não
  chega em 5 s, e um Guarita lento pode precisar de ajuste de prazo.

## 2. Importar o cadastro

**Faça:** "Importar cadastro".

**Deve aparecer:** total igual ao do visor do Guarita; uma cópia de segurança nova na lista; os
dispositivos em "A vincular" ou já ligados a veículos.

**Confira à mão 5 dispositivos** de tipos diferentes (controle, TAG, cartão): unidade, bloco, rótulo
e placa têm de ser os mesmos que o Guarita mostra no visor. **Se um único campo divergir, pare:** o
formato do registro não é o que o documento descreve, e nenhuma gravação pode ser feita.

**Se a importação falhar no meio:** tente de novo uma vez. O Prestare nunca aproveita importação parcial.

## 3. Baixar a cópia de segurança

**Faça:** baixe a cópia criada no passo 2 e guarde fora do Prestare.

## 4. Receber um evento ao vivo

**Faça:** acione um controle e passe uma TAG já cadastrados.

**Deve aparecer:** os dois acessos no histórico em poucos segundos, com morador, unidade e o portão
certo, na hora certa.

**Se não:**
- Nada chega: o envio automático de eventos pode estar desligado ou filtrado na programação do
  Guarita (o Prestare não altera a programação; peça ao instalador).
- Hora errada: veja a diferença de relógio no cartão do aparelho.
- Portão errado: corrija o cadastro de portões (receptor e botão) — e **não faça o passo 5** antes disso.

## 5. Abrir um portão

**Faça:** com alguém olhando o portão, cadastre o portão (receptor e relé) e clique em abrir.

**Deve acontecer:** aquele portão, e só ele, abre uma vez; o histórico registra quem abriu.

**Se abrir outro portão:** o número do receptor ou do relé está trocado no cadastro. Corrija e repita.
**Se não abrir:** anote; o Guarita não responde a esse comando, então a tela só diz "comando enviado".

Repita o passo 4 e o passo 5 **durante** uma importação (passo 2): o portão tem de abrir em poucos
segundos mesmo com a leitura em andamento. Se não abrir, anote — é o ponto do protocolo que o
documento não esclarece.

## 6. Gravar UM dispositivo de teste

Use um controle ou uma TAG que não pertença a nenhum morador.

1. **Capturar:** em Veículos, "Cadastrar controle/tag" num veículo de teste; no Guarita, o porteiro
   entra em Menu > Cadastro Rápido e aciona o dispositivo. O serial tem de aparecer na tela.
2. **Confirmar:** o estado passa por "Pendente" → "Gravado no Guarita" → "Ativo nos portões"
   (este último leva até alguns minutos: é a atualização dos receptores).
3. **Conferir no Guarita:** o dispositivo aparece no visor com a unidade, o bloco, o rótulo e a placa
   certos.
4. **Testar no portão:** ele abre. Anote se abriu logo após "Gravado" ou só depois de "Ativo".
5. **Conferir os outros:** acione dois dispositivos antigos de moradores. Continuam funcionando.
6. **Repetir o passo 2 (importar):** o total subiu exatamente 1.

**Se qualquer item falhar, pare e não grave mais nada.**

## 7. Editar e remover o dispositivo de teste

1. Troque a placa do veículo de teste. O Guarita mostra a placa nova; o dispositivo continua abrindo.
2. Remova o dispositivo ("Remover do Guarita"). Estado "Removendo" e depois some.
3. No Guarita ele não existe mais, e não abre o portão.
4. Importar de novo: o total voltou ao número do começo. **Compare a cópia de segurança nova com a do
   passo 3: fora o dispositivo de teste, não pode haver nenhuma diferença.**

## 8. Conflito e desligamento

1. Tente cadastrar por código um dispositivo que já é de outro morador. O Prestare tem de mostrar
   "Conflito" e **não** alterar nada no Guarita (confira no visor).
2. Desligue o cabo de rede do Guarita por 2 minutos e religue. O estado volta a "Conectado"; os
   acessos feitos no intervalo aparecem no histórico; o portão abriu normalmente durante a queda.
3. Desligue o computador do agente. O portão continua abrindo pelos controles.

## Só então

Libere o uso normal: vincular os dispositivos importados, aprovar tags pedidas pelo app, cadastrar novos.

## O que anotar para devolver

- Modelo e firmware; quantos dispositivos; quanto tempo levou a importação.
- Em qual momento o dispositivo novo passou a abrir (depois de "Gravado" ou de "Ativo").
- Se o portão abriu durante a importação e durante a atualização dos receptores.
- Qualquer queda de conexão, com a hora.
- Diferenças entre o que o Prestare mostrou e o visor do Guarita.
