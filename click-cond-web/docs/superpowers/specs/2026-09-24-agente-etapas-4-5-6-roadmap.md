# Agente Local — Etapas 4, 5 e 6 (roteiro, adiadas)

Data: 2026-09-24 · Status: **roteiro, sem desenho detalhado.** Cada etapa depende do
equipamento físico para ser testada de verdade. Retomar quando houver o aparelho em mãos ou um
cliente que precise dele, começando pela que o primeiro cliente pedir. Cada uma passa pelo
processo completo: brainstorming → spec → plano → implementação.

Contexto: plano de 6 etapas do agente aprovado em 23/09/2026 (abordagem A, drivers por
`(tipo, fabricante)`). Etapa 1 publicada (drivers, supervisor, telemetria, auto-atualização,
serviço). Etapa 2 desenhada e adiada:
`2026-09-24-agente-etapa2-conferencia-facial-design.md`. Etapa 3 (descoberta na rede) em
andamento.

Premissa comum às três, decidida com o usuário: **o próprio equipamento decide o acesso.** A
nuvem mantém a lista de autorizados sincronizada no aparelho (como já faz com os faciais), e o
aparelho libera sozinho mesmo sem internet. Os eventos voltam para a nuvem pelo agente, com
replay offline.

O contrato de driver da etapa 1 já prevê isso: `testar`, `executar` (cadastrar, remover,
listar, abrir), `escutar` (eventos ao vivo), `buscarDesde` (replay offline) e `acertarRelogio`.
`resolverDriver` escolhe pelo fabricante e `resolverDriverDeEventos` hoje só atende
`tipo = 'facial'`; cada etapa abaixo registra o seu tipo.

## Etapa 4 — LPR (leitura de placa)

- **Hardware:** câmeras LPR Intelbras e Hikvision.
- **O que entrega:** o veículo de morador ou visitante cadastrado é liberado pela câmera. A placa
  lida vira um evento de acesso na portaria (quem, qual veículo, entrada/saída).
- **Trabalho previsto:**
  - driver `lpr` por fabricante: sincronizar a lista de placas autorizadas (lista branca da
    câmera), ouvir o evento de placa lida e recuperar o log offline;
  - nuvem: a lista de placas sai dos veículos já cadastrados (moradores, visitantes com veículo);
    cadastro/remoção disparam o envio, como acontece com os rostos;
  - portal: evento de placa na portaria com a foto da leitura, quando a câmera enviar.
- **A confirmar no aparelho:** API da lista branca em cada marca, formato do evento, se a
  câmera aciona o portão sozinha (saída de relé) ou precisa de controladora, e tolerância a
  placa Mercosul/antiga.

## Etapa 5 — Antenas UHF (tag veicular)

- **Hardware:** antenas UHF Intelbras e Control iD, com tags adesivas nos veículos.
- **O que entrega:** a tag do carro abre o portão pela antena. O cadastro da tag fica no veículo
  do morador.
- **Trabalho previsto:**
  - nuvem: campo de tag no veículo (ou tabela de credenciais do veículo), com cadastro no portal;
  - driver `antena` por fabricante: gravar e remover tags autorizadas, ouvir leituras, replay
    offline;
  - conferência periódica igual à dos faciais (etapa 2): tag na antena que não existe no banco é
    removida.
- **A confirmar no aparelho:** se a antena fala direto com a rede (IP) ou só via controladora
  (Wiegand), formato do número da tag, e se aceita lista de autorizados própria.

## Etapa 6 — Guarita Linear, Central Nice e controladoras (Wiegand)

- **Hardware:** Módulo Guarita Linear IP, Central Nice IP e controladoras Control iD/Intelbras,
  recebendo controles remotos, tags e cartões Wiegand (Linear/Nice).
- **O que entrega:** controles e tags das centrais que os condomínios já usam passam a ser
  geridos pelo sistema: cadastro no portal, remoção quando o morador sai, eventos na portaria.
- **Trabalho previsto:**
  - driver por central: sincronizar a memória de controles/tags (incluir, remover, listar),
    ouvir acionamentos, replay offline;
  - nuvem: credencial do tipo "controle/tag Wiegand" vinculada a morador/unidade;
  - conferência periódica (remover da central quem não está mais autorizado).
- **A confirmar no aparelho:** protocolo de cada central (a Guarita Linear usa protocolo
  proprietário via módulo IP; a Nice idem), limite de memória da central e se o evento traz o
  número do controle.

## Ordem sugerida

Pelo pedido do primeiro cliente. Sem cliente definido: LPR (4) primeiro, porque as câmeras
Intelbras/Hikvision têm API HTTP documentada, parecida com a dos faciais que já integramos.
