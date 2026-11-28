// Máquina de estados de uma chamada do interfone. Pura: não fala com o
// Asterisk nem com a API — cada método devolve a lista de AÇÕES que o serviço
// (servico.js) executa em ordem. Uma transição por vez; depois de `encerrada`
// nada mais acontece (quem tentar entrar é recusado).
//
// Estados: chamando → atendida | portaria → atendida | encerrada.
// Tipos: facial_unidade (visitante no facial), portaria_unidade (console liga
// para a unidade), unidade_portaria (morador liga para a portaria).

const TIPOS = new Set(['facial_unidade', 'portaria_unidade', 'unidade_portaria']);

const RESULTADO_POR_PAPEL = {
  morador: 'atendida_morador',
  monitor: 'atendida_morador',
  portaria: 'atendida_portaria',
};

export function criarChamada({
  id,
  tipo,
  toqueS,
  toquePortariaS,
  maxConversaS = 180,
  avisoAntesS = 30,
  canalOrigem,
  monitores = [],
  relogio = Date.now,
}) {
  if (!TIPOS.has(tipo)) throw new Error(`Tipo de chamada desconhecido: ${tipo}`);
  const toquePortaria = toquePortariaS ?? toqueS;

  let estado = tipo === 'unidade_portaria' ? 'portaria' : 'chamando';
  let iniciada = false;
  let aguardandoResposta = false; // toque_esgotado enviado, esperando a API
  let atendida = null; // { papel, uid, canal, em }

  const duracao = () => (atendida ? Math.max(0, Math.round((relogio() - atendida.em) / 1000)) : 0);

  function fechar(resultado, { mensagem = false } = {}) {
    const d = duracao();
    estado = 'encerrada';
    aguardandoResposta = false;
    const acoes = [];
    if (mensagem) acoes.push({ acao: 'tocar_mensagem', som: 'ninguem-atendeu' });
    acoes.push({ acao: 'desligar_tudo' });
    acoes.push({ acao: 'evento', evento: 'encerrada', resultado, duracao_s: d });
    return acoes;
  }

  // Ninguém atendeu: só o visitante no facial ouve a mensagem; console e app
  // mostram o próprio aviso quando a chamada cai sem ter sido atendida.
  const naoAtendida = () => fechar('nao_atendida', { mensagem: tipo === 'facial_unidade' });
  const fecharAtendida = () => fechar(RESULTADO_POR_PAPEL[atendida.papel] ?? 'atendida_morador');

  function irParaPortaria() {
    estado = 'portaria';
    aguardandoResposta = false;
    return [{ acao: 'agendar', nome: 'toque_portaria', s: toquePortaria }];
  }

  // Papel × estado: o morador só atende enquanto toca no apartamento; o
  // porteiro só depois que a chamada foi para a portaria (unidade_portaria já
  // nasce lá). Token válido pego antes da transferência não vale depois dela.
  const PODE_ENTRAR = { morador: 'chamando', portaria: 'portaria' };

  function entrou({ papel, uid, canal }) {
    if (estado === 'encerrada' || estado === 'atendida') return [{ acao: 'recusar_canal', canal }];
    if (Object.hasOwn(PODE_ENTRAR, papel) && PODE_ENTRAR[papel] !== estado) return [{ acao: 'recusar_canal', canal }];
    atendida = { papel, uid, canal, em: relogio() };
    estado = 'atendida';
    aguardandoResposta = false;
    const acoes = [{ acao: 'atender_origem' }];
    // Canal do monitor foi originado por nós e já chega atendido.
    if (papel !== 'monitor') acoes.push({ acao: 'atender_canal', canal });
    acoes.push(
      { acao: 'ponte', canais: [canalOrigem, canal] },
      { acao: 'cancelar_toques' },
      { acao: 'desligar_monitores' },
      { acao: 'evento', evento: 'atendida', papel, uid },
      { acao: 'agendar', nome: 'aviso', s: maxConversaS - avisoAntesS },
      { acao: 'agendar', nome: 'fim', s: maxConversaS },
    );
    return acoes;
  }

  return {
    id,
    tipo,
    canalOrigem,
    toqueS,
    get estado() { return estado; },
    get canalAtendido() { return atendida?.canal ?? null; },
    get papelAtendido() { return atendida?.papel ?? null; },

    iniciar() {
      if (iniciada || estado === 'encerrada') return [];
      iniciada = true;
      if (tipo === 'unidade_portaria') {
        return [{ acao: 'tocar_origem' }, { acao: 'agendar', nome: 'toque_portaria', s: toquePortaria }];
      }
      return [
        { acao: 'tocar_origem' },
        { acao: 'agendar', nome: 'toque', s: toqueS },
        ...monitores.map((conta) => ({ acao: 'ligar_monitor', conta })),
      ];
    },

    entrou,

    monitorAtendeu(conta, canal) {
      return entrou({ papel: 'monitor', uid: Number(String(conta).replace(/^mon-?/, '')), canal });
    },

    expirou(nome) {
      if (nome === 'toque') {
        if (estado !== 'chamando' || aguardandoResposta) return [];
        // Portaria ligando para a unidade não transfere: só avisa que ninguém atendeu.
        if (tipo !== 'facial_unidade') return naoAtendida();
        aguardandoResposta = true;
        return [{ acao: 'evento', evento: 'toque_esgotado' }];
      }
      if (nome === 'toque_portaria') return estado === 'portaria' ? naoAtendida() : [];
      if (nome === 'aviso') return estado === 'atendida' ? [{ acao: 'tocar_mensagem_ponte', som: 'beep' }] : [];
      if (nome === 'fim') return estado === 'atendida' ? fecharAtendida() : [];
      return [];
    },

    resposta(proximo) {
      if (estado !== 'chamando' || !aguardandoResposta) return [];
      return proximo === 'portaria' ? irParaPortaria() : naoAtendida();
    },

    forcarPortaria() {
      return estado === 'chamando' ? irParaPortaria() : [];
    },

    origemDesligou() {
      if (estado === 'encerrada') return [];
      if (estado === 'atendida') return fecharAtendida();
      return fechar('cancelada');
    },

    participanteDesligou(canal) {
      if (estado !== 'atendida' || canal !== atendida.canal) return [];
      return fecharAtendida();
    },

    encerrar() {
      if (estado === 'encerrada') return [];
      if (estado === 'atendida') return fecharAtendida();
      // Facial encerrado pela portaria sem atender = não atendida; ligação
      // originada pelo console/app encerrada antes de atender = cancelada.
      return fechar(tipo === 'facial_unidade' ? 'nao_atendida' : 'cancelada');
    },

    falhou() {
      if (estado === 'encerrada') return [];
      return fechar('falha');
    },
  };
}
