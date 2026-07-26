import 'package:click/pages/shared/agenda/list_agenda.dart';
import 'package:click/pages/shared/areas%20sociais/list_areas_sociais.dart';
import 'package:click/pages/shared/assembleias/list_assembleias.dart';
import 'package:click/pages/shared/comunicados/list_comunicados.dart';
import 'package:click/pages/shared/docs/list_docs.dart';
import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/shared/enquetes/list_enquetes.dart';
import 'package:click/pages/shared/financeiro/list_financeiro.dart';
import 'package:click/pages/shared/financeiro/morador_financeiro_view.dart';
import 'package:click/pages/shared/morador/my_apartamento_view.dart';
import 'package:click/pages/shared/mudancas/list_mudancas.dart';
import 'package:click/pages/shared/ocorrencias/list_ocorrencias.dart';
import 'package:click/pages/shared/prestador%20de%20servico/list_prestadores.dart';
import 'package:click/pages/shared/veiculos/list_veiculos.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';

/// Traduz a chave de tela que o assistente devolve para a página do app.
///
/// As chaves são as mesmas do TELAS_APP no backend. É esse mapa que faz o
/// "sistema todo conversar": quando o assistente não tem ferramenta para
/// executar algo, ele ainda leva o morador à tela certa em vez de dizer que
/// não consegue.
///
/// Retorna null para chave desconhecida — o card simplesmente não navega, em
/// vez de quebrar. Backend e app podem ficar em versões diferentes.
Widget? telaPorChave(String chave) {
  switch (chave) {
    case 'areas_sociais':
      return ListAreasSociais();
    case 'financeiro':
      // Morador tem a visão própria; síndico/funcionário veem o financeiro
      // completo — mesma escolha feita no menu da home.
      return getUserType() == 'morador'
          ? const MoradorFinanceiroView()
          : const ListFinanceiro();
    case 'encomendas':
      return const ListEncomendas();
    case 'assembleias':
      return ListAssembleias();
    case 'enquetes':
      return ListEnquetes();
    case 'comunicados':
      return ListComunicados();
    case 'ocorrencias':
      return ListOcorrencias();
    case 'manutencoes':
      return ListAgenda();
    case 'prestadores':
      return ListPrestadores();
    case 'mudancas':
      return ListMudancas();
    case 'visitantes':
      return ListVisitantes();
    case 'apartamento':
      return const MyApartamentoView();
    case 'veiculos':
      return ListVeiculos();
    case 'documentos':
      return ListDocs();
    default:
      return null;
  }
}
