import 'dart:convert';

import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/cells/cell_votacao.dart';
import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:click/widgets/votacao/seletor_unidade_voto.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Rodada 5 (assembleia robusta): `votosPorUnidade[]` ganha `tipo_vinculo`,
// `pode_votar`, `motivo` e `votado_por`. Unidade sem direito mostra o motivo
// e não deixa votar; voto vigente de outro morador aparece como "Votado pelo
// proprietário/inquilino". API antiga (sem os campos) = como antes.

const _motivoProprietario = 'O proprietário da unidade já votou; o voto dele não pode ser alterado por inquilino.';
const _motivoMembro = 'Membro da unidade não vota em pauta de assembleia.';

Map<String, dynamic> linha({
  int idVotacao = 7,
  int idApto = 200,
  String rotulo = 'Apto 21',
  String? opcao,
  String? tipo,
  bool? pode,
  String? motivo,
  String? votadoPor,
}) =>
    {
      'id_votacao': idVotacao,
      'id_apto': idApto,
      'rotulo': rotulo,
      'opcao': opcao,
      if (tipo != null) 'tipo_vinculo': tipo,
      if (pode != null) 'pode_votar': pode,
      if (motivo != null) 'motivo': motivo,
      if (votadoPor != null) 'votado_por': votadoPor,
    };

Map<String, dynamic> pauta({int status = 1, int somenteProp = 0}) => {
      'id': 7,
      'titulo': 'Aprovação das contas',
      'descricao': '',
      'data_inicio': '01/10/2026',
      'data_termino': '30/10/2099',
      'status': status,
      'opcoes': ['12;Aprovo;0', '13;Reprovo;0'],
      'resultado_oculto': status != 2,
      'somente_proprietarios': somenteProp,
      'participacao': {'unidades_votaram': 1, 'unidades_total': 40},
    };

void main() {
  group('helpers', () {
    test('unidadesDaVotacao lê os campos novos; ausentes = pode votar, sem autor', () {
      final u = unidadesDaVotacao([
        linha(tipo: 'inquilino', pode: false, motivo: _motivoProprietario, votadoPor: 'proprietario'),
        linha(idApto: 300),
      ], 7);
      expect(u[0].tipoVinculo, 'inquilino');
      expect(u[0].podeVotar, isFalse);
      expect(u[0].motivo, _motivoProprietario);
      expect(u[0].votadoPor, 'proprietario');
      expect(u[1].podeVotar, isTrue);
      expect(u[1].motivo, isNull);
      expect(u[1].votadoPor, isNull);
      expect(u[1].tipoVinculo, isNull);
    });

    test('normalizarNivel aceita acento, caixa e lixo', () {
      expect(normalizarNivel('Proprietário'), 'proprietario');
      expect(normalizarNivel('INQUILINO'), 'inquilino');
      expect(normalizarNivel('membro'), 'membro');
      expect(normalizarNivel(null), isNull);
      expect(normalizarNivel('null'), isNull);
      expect(normalizarNivel('outro'), isNull);
    });

    test('votoDeOutro: autor de outro nível ou opção escondida', () {
      // Inquilino vendo o voto do proprietário: a opção não vem.
      expect(const UnidadeVoto(idApto: 1, rotulo: '', votadoPor: 'proprietario', tipoVinculo: 'inquilino').votoDeOutro,
          isTrue);
      // Proprietário vendo o voto do inquilino: a opção vem.
      expect(
          const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12', votadoPor: 'inquilino', tipoVinculo: 'proprietario')
              .votoDeOutro,
          isTrue);
      // Voto do mesmo nível: tratado como da própria conta.
      expect(
          const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12', votadoPor: 'proprietario', tipoVinculo: 'proprietario')
              .votoDeOutro,
          isFalse);
      // API antiga.
      expect(const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12').votoDeOutro, isFalse);
      expect(const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12', votadoPor: 'inquilino', tipoVinculo: 'proprietario')
          .meuVoto, isNull);
      expect(const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12').meuVoto, '12');
      // A unidade votou mesmo sem a opção visível.
      expect(const UnidadeVoto(idApto: 1, rotulo: '', votadoPor: 'proprietario').votou, isTrue);
    });

    test('rotuloVotadoPor', () {
      expect(rotuloVotadoPor('proprietario'), 'Votado pelo proprietário');
      expect(rotuloVotadoPor('inquilino'), 'Votado pelo inquilino');
      expect(rotuloVotadoPor('membro'), 'Votado por morador da unidade');
      expect(rotuloVotadoPor(null), isNull);
    });

    test('situacaoVoto: status manda; sem direito antes de tudo; voto de outro', () {
      const semDireito = UnidadeVoto(idApto: 1, rotulo: '', podeVotar: false, motivo: _motivoMembro);
      const deOutro = UnidadeVoto(idApto: 1, rotulo: '', opcao: '12', votadoPor: 'inquilino', tipoVinculo: 'proprietario');
      expect(situacaoVoto(status: 0, jaVotou: false), SituacaoVoto.agendada);
      expect(situacaoVoto(status: 2, jaVotou: true, unidade: semDireito), SituacaoVoto.encerrada);
      expect(situacaoVoto(status: null, jaVotou: false), SituacaoVoto.desconhecida);
      expect(situacaoVoto(status: 1, jaVotou: false), SituacaoVoto.aberta);
      expect(situacaoVoto(status: 1, jaVotou: true), SituacaoVoto.jaVotou);
      expect(situacaoVoto(status: 1, jaVotou: true, alterando: true), SituacaoVoto.alterando);
      expect(situacaoVoto(status: 1, jaVotou: false, unidade: semDireito), SituacaoVoto.semDireito);
      expect(situacaoVoto(status: 1, jaVotou: true, unidade: semDireito), SituacaoVoto.semDireito);
      expect(situacaoVoto(status: 1, jaVotou: false, unidade: deOutro), SituacaoVoto.votadoPorOutro);
      // Uma unidade, voto do mesmo nível de outra conta (não está em meusVotos).
      expect(
          situacaoVoto(
              status: 1,
              jaVotou: false,
              unidade: const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12', votadoPor: 'proprietario', tipoVinculo: 'proprietario')),
          SituacaoVoto.votadoPorOutro);
      expect(podeEscolher(SituacaoVoto.aberta), isTrue);
      expect(podeEscolher(SituacaoVoto.alterando), isTrue);
      expect(podeEscolher(SituacaoVoto.votadoPorOutro), isTrue);
      expect(podeEscolher(SituacaoVoto.semDireito), isFalse);
      expect(podeEscolher(SituacaoVoto.jaVotou), isFalse);
    });

    test('textos do voto de outro e da falta de direito', () {
      final ops = parseOpcoes(['12;Aprovo;0', '13;Reprovo;0']);
      expect(
          textoVotadoPorOutro(
              const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12', votadoPor: 'inquilino', tipoVinculo: 'proprietario'),
              ops),
          'Votado pelo inquilino: Aprovo. Se votar, o seu voto substitui este.');
      expect(textoVotadoPorOutro(const UnidadeVoto(idApto: 1, rotulo: '', votadoPor: 'proprietario'), ops),
          'Votado pelo proprietário.');
      expect(textoSemDireito(const UnidadeVoto(idApto: 1, rotulo: '', podeVotar: false, motivo: _motivoMembro)),
          _motivoMembro);
      expect(
          textoSemDireito(const UnidadeVoto(
              idApto: 1, rotulo: '', podeVotar: false, motivo: _motivoProprietario, votadoPor: 'proprietario')),
          'Votado pelo proprietário. $_motivoProprietario');
      expect(textoSemDireito(const UnidadeVoto(idApto: 1, rotulo: '', podeVotar: false)),
          'Esta unidade não pode votar nesta votação.');
    });

    test('subtituloUnidade do seletor', () {
      final ops = parseOpcoes(['12;Aprovo;0']);
      expect(subtituloUnidade(const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12'), ops), 'Voto atual: Aprovo');
      expect(subtituloUnidade(const UnidadeVoto(idApto: 1, rotulo: ''), ops), 'Ainda não votou');
      expect(
          subtituloUnidade(const UnidadeVoto(idApto: 1, rotulo: '', votadoPor: 'proprietario', tipoVinculo: 'inquilino'), ops),
          'Votado pelo proprietário');
      expect(
          subtituloUnidade(
              const UnidadeVoto(idApto: 1, rotulo: '', opcao: '12', votadoPor: 'inquilino', tipoVinculo: 'proprietario'),
              ops),
          'Votado pelo inquilino: Aprovo');
      expect(
          subtituloUnidade(const UnidadeVoto(idApto: 1, rotulo: '', podeVotar: false, motivo: _motivoMembro), ops),
          _motivoMembro);
    });

    test('unidadePadrao prefere a unidade que pode votar e ainda não votou', () {
      const us = [
        UnidadeVoto(idApto: 1, rotulo: '', podeVotar: false, motivo: _motivoMembro),
        UnidadeVoto(idApto: 2, rotulo: ''),
      ];
      expect(unidadePadrao(us), 2);
    });
  });

  group('telas', () {
    TestWidgetsFlutterBinding.ensureInitialized();
    const json = {'content-type': 'application/json; charset=utf-8'};
    late List<Map<String, dynamic>> votosEnviados;

    setUp(() async {
      await ensureStorageReady();
      Singleton.instance.id_condominio = 22;
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      votosEnviados = [];
    });

    tearDown(() async {
      ApiClient.restaurarPadroes();
      await storageLogout();
      Singleton.instance.reset();
    });

    void servirAssembleia(List<Map<String, dynamic>> votosPorUnidade,
        {List<String> meusVotos = const [], Map<String, dynamic>? votacao}) {
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get')) {
          return http.Response(
              jsonEncode({
                'assembleia': {'id': 5, 'titulo': 'AGO', 'data': '11/10/2026', 'hora': '19:30'},
                'votacoes': [votacao ?? pauta()],
                'meusVotos': meusVotos,
                'votosPorUnidade': votosPorUnidade,
              }),
              200,
              headers: json);
        }
        if (request.url.path.endsWith('/assembleias/votacoes/voto/insert')) {
          votosEnviados.add((jsonDecode(request.body) as Map<String, dynamic>)['voto']);
          return http.Response('{}', 201, headers: json);
        }
        return http.Response('', 404);
      });
    }

    void servirEnquete(List<Map<String, dynamic>> votosPorUnidade, {List<String> meuVoto = const []}) {
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/votacoes/enquetes/get')) {
          return http.Response(
              jsonEncode({'votacao': pauta(), 'meuVoto': meuVoto, 'votosPorUnidade': votosPorUnidade}), 200,
              headers: json);
        }
        return http.Response('', 404);
      });
    }

    Future<void> abrir(WidgetTester tester, Widget tela) async {
      tester.view.physicalSize = const Size(400 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: tela));
      await tester.pumpAndSettle();
    }

    testWidgets('pauta: membro não vota — motivo, sem opção tocável e sem botão', (tester) async {
      servirAssembleia([linha(tipo: 'membro', pode: false, motivo: _motivoMembro)]);
      await abrir(tester, const DetailAssembleia(id: 5));

      expect(find.text(_motivoMembro), findsOneWidget);
      expect(find.byType(OpcaoSelecionavel), findsNothing);
      expect(find.byType(OpcaoResultadoBar), findsNWidgets(2));
      expect(find.byKey(CellVotacao.chaveVotar(7)), findsNothing);
    });

    testWidgets('pauta: inquilino com voto do proprietário — "Votado pelo proprietário" e sem votar', (tester) async {
      servirAssembleia(
          [linha(tipo: 'inquilino', pode: false, motivo: _motivoProprietario, votadoPor: 'proprietario')]);
      await abrir(tester, const DetailAssembleia(id: 5));

      expect(find.text('Votado pelo proprietário. $_motivoProprietario'), findsOneWidget);
      expect(find.byType(OpcaoSelecionavel), findsNothing);
      expect(find.byKey(CellVotacao.chaveVotar(7)), findsNothing);
      expect(tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).map((b) => b.meuVoto),
          [false, false]);
    });

    testWidgets('pauta: proprietário vê o voto do inquilino e pode votar por cima', (tester) async {
      servirAssembleia([linha(tipo: 'proprietario', pode: true, opcao: '12', votadoPor: 'inquilino')]);
      await abrir(tester, const DetailAssembleia(id: 5));

      expect(find.text('Votado pelo inquilino: Aprovo. Se votar, o seu voto substitui este.'), findsOneWidget);
      expect(find.byType(OpcaoSelecionavel), findsNWidgets(2));
      expect(tester.widget<AppButton>(find.byKey(CellVotacao.chaveVotar(7))).label, 'Votar');

      await tester.tap(find.text('Reprovo'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(CellVotacao.chaveVotar(7)));
      await tester.tap(find.byKey(CellVotacao.chaveVotar(7)));
      await tester.pumpAndSettle();
      expect(votosEnviados, [
        {'votacao_id': 7, 'opcao_id': 13, 'id_apto': 200}
      ]);
    });

    testWidgets('pauta somente proprietários mostra o selo', (tester) async {
      servirAssembleia([linha(tipo: 'proprietario', pode: true)], votacao: pauta(somenteProp: 1));
      await abrir(tester, const DetailAssembleia(id: 5));
      expect(find.text('Somente proprietários'), findsOneWidget);
    });

    testWidgets('API antiga (sem os campos novos): vota como antes', (tester) async {
      servirAssembleia([
        {'id_votacao': 7, 'id_apto': 200, 'rotulo': 'Apto 21', 'opcao': null}
      ]);
      await abrir(tester, const DetailAssembleia(id: 5));
      expect(find.byType(OpcaoSelecionavel), findsNWidgets(2));
      expect(find.text('Somente proprietários'), findsNothing);
    });

    testWidgets('enquete: sem direito mostra o motivo e esconde o rodapé de votar', (tester) async {
      servirEnquete([linha(tipo: 'membro', pode: false, motivo: 'Só proprietários votam nesta enquete.')]);
      await abrir(tester, const DetailEnquete(id: 7));

      expect(find.text('Só proprietários votam nesta enquete.'), findsOneWidget);
      expect(find.byType(OpcaoSelecionavel), findsNothing);
      expect(find.byKey(DetailEnquete.chaveBotaoVotar), findsNothing);
    });

    testWidgets('enquete: proprietário com voto do inquilino pode votar', (tester) async {
      servirEnquete([linha(tipo: 'proprietario', pode: true, opcao: '13', votadoPor: 'inquilino')]);
      await abrir(tester, const DetailEnquete(id: 7));

      expect(find.textContaining('Votado pelo inquilino: Reprovo'), findsOneWidget);
      expect(find.byType(OpcaoSelecionavel), findsNWidgets(2));
      expect(tester.widget<AppButton>(find.byKey(DetailEnquete.chaveBotaoVotar)).label, 'Votar');
    });

    testWidgets('duas unidades: o seletor mostra quem votou em cada uma', (tester) async {
      servirAssembleia([
        linha(tipo: 'inquilino', pode: false, motivo: _motivoProprietario, votadoPor: 'proprietario'),
        linha(idApto: 300, rotulo: 'Apto 31', tipo: 'proprietario', pode: true),
      ]);
      await abrir(tester, const DetailAssembleia(id: 5));

      expect(find.byType(SeletorUnidadeVoto), findsOneWidget);
      expect(find.text('Votado pelo proprietário'), findsOneWidget);
      // Abre na unidade que pode votar.
      expect(tester.widget<SeletorUnidadeVoto>(find.byType(SeletorUnidadeVoto)).selecionada, 300);
      expect(find.byType(OpcaoSelecionavel), findsNWidgets(2));
    });
  });
}
