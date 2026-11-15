import 'package:click/models/veiculo_model.dart';
import 'package:click/pages/shared/veiculos/guarita_estado.dart';
import 'package:click/widgets/app/app_tag.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Estado da tag do veículo no Módulo Guarita. O campo é opcional: sem ele
/// (condomínio sem Guarita, ou API antiga) a tela fica exatamente como antes.
void main() {
  group('rotuloEstadoGuarita', () {
    test('cada estado conhecido tem o seu texto', () {
      expect(rotuloEstadoGuarita('aguardando_aprovacao'),
          'Aguardando aprovação da portaria');
      expect(rotuloEstadoGuarita('pendente'), 'Enviando ao portão');
      expect(rotuloEstadoGuarita('gravado'), 'Gravado no portão');
      expect(rotuloEstadoGuarita('ativo'), 'Ativo nos portões');
      expect(rotuloEstadoGuarita('falhou'), 'Não foi possível gravar no portão');
      expect(rotuloEstadoGuarita('removendo'), 'Removendo do portão');
    });

    test('a_vincular, nulo, vazio ou desconhecido não têm selo', () {
      expect(rotuloEstadoGuarita('a_vincular'), isNull);
      expect(rotuloEstadoGuarita(null), isNull);
      expect(rotuloEstadoGuarita(''), isNull);
      expect(rotuloEstadoGuarita('   '), isNull);
      expect(rotuloEstadoGuarita('qualquer_coisa'), isNull);
    });
  });

  group('sinalEstadoGuarita', () {
    test('gravado e ativo são ok; em andamento é aviso; falhou é perigo', () {
      expect(sinalEstadoGuarita('ativo'), AppSignal.ok);
      expect(sinalEstadoGuarita('gravado'), AppSignal.ok);
      expect(sinalEstadoGuarita('aguardando_aprovacao'), AppSignal.warn);
      expect(sinalEstadoGuarita('pendente'), AppSignal.warn);
      expect(sinalEstadoGuarita('removendo'), AppSignal.warn);
      expect(sinalEstadoGuarita('falhou'), AppSignal.danger);
    });
  });

  group('VeiculoModel', () {
    test('lê guarita_estado e guarita_erro quando vêm', () {
      final v = VeiculoModel.fromJson({
        'id': 1,
        'placa': 'ABC1D23',
        'tag_codigo': 'G2-0F086E',
        'guarita_estado': 'falhou',
        'guarita_erro': 'Guarita não respondeu',
      });
      expect(v.guaritaEstado, 'falhou');
      expect(v.guaritaErro, 'Guarita não respondeu');
    });

    test('sem os campos (API antiga / sem Guarita) ficam nulos', () {
      final v = VeiculoModel.fromJson({'id': 1, 'placa': 'ABC1D23'});
      expect(v.guaritaEstado, isNull);
      expect(v.guaritaErro, isNull);
    });

    test('o estado não é enviado de volta ao salvar', () {
      final v = VeiculoModel(id: 1, placa: 'ABC1D23', guaritaEstado: 'ativo');
      expect(v.toJson(incluirTag: true).containsKey('guarita_estado'), isFalse);
    });
  });

  group('estadoGuaritaDaResposta', () {
    test('lê do topo ou de dentro de "veiculo"', () {
      expect(estadoGuaritaDaResposta('{"id":3,"guarita_estado":"aguardando_aprovacao"}'),
          'aguardando_aprovacao');
      expect(
          estadoGuaritaDaResposta(
              '{"ok":true,"veiculo":{"id":3,"guarita_estado":"pendente"}}'),
          'pendente');
    });

    test('corpo sem o campo, vazio ou inválido devolve nulo', () {
      expect(estadoGuaritaDaResposta('{"ok":true}'), isNull);
      expect(estadoGuaritaDaResposta(''), isNull);
      expect(estadoGuaritaDaResposta('não é json'), isNull);
      expect(estadoGuaritaDaResposta('[1,2]'), isNull);
    });
  });

  group('estadoGuaritaNaLista', () {
    final lista = [
      {'id': 1, 'placa': 'AAA1A11', 'guarita_estado': 'ativo'},
      {'id': 2, 'placa': 'BBB2B22', 'guarita_estado': 'aguardando_aprovacao'},
      {'id': 3, 'placa': 'CCC3C33'},
    ];

    test('acha pelo id', () {
      expect(estadoGuaritaNaLista(lista, id: 2), 'aguardando_aprovacao');
    });

    test('sem id, acha pela placa (sem diferenciar traço e caixa)', () {
      expect(estadoGuaritaNaLista(lista, placa: 'bbb-2b22'), 'aguardando_aprovacao');
    });

    test('veículo sem o campo, ausente ou lista inválida devolve nulo', () {
      expect(estadoGuaritaNaLista(lista, id: 3), isNull);
      expect(estadoGuaritaNaLista(lista, id: 99), isNull);
      expect(estadoGuaritaNaLista('x', id: 1), isNull);
      expect(estadoGuaritaNaLista(lista), isNull);
    });
  });

  group('mensagemSucessoVeiculo', () {
    test('sem aguardar aprovação, é a mensagem de sempre', () {
      expect(mensagemSucessoVeiculo(isEdit: false, estado: null), 'Veículo cadastrado!');
      expect(mensagemSucessoVeiculo(isEdit: true, estado: 'ativo'), 'Veículo atualizado!');
    });

    test('aguardando aprovação acrescenta o aviso da tag', () {
      final m = mensagemSucessoVeiculo(isEdit: false, estado: 'aguardando_aprovacao');
      expect(m, startsWith('Veículo cadastrado!'));
      expect(m, contains(avisoTagAguardandoAprovacao));
      expect(avisoTagAguardandoAprovacao,
          'Tag enviada. Ela começa a valer no portão depois que a portaria aprovar.');
    });
  });

  group('SeloEstadoGuarita', () {
    Future<void> montar(WidgetTester t, {String? estado, String? erro}) {
      return t.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 180,
            child: SeloEstadoGuarita(estado: estado, erro: erro),
          ),
        ),
      ));
    }

    testWidgets('sem estado não desenha nada', (t) async {
      await montar(t);
      expect(find.byType(AppTag), findsNothing);
    });

    testWidgets('a_vincular não desenha nada', (t) async {
      await montar(t, estado: 'a_vincular');
      expect(find.byType(AppTag), findsNothing);
    });

    testWidgets('ativo mostra o selo', (t) async {
      await montar(t, estado: 'ativo');
      expect(find.text('ATIVO NOS PORTÕES'), findsOneWidget);
      expect(t.takeException(), isNull);
    });

    testWidgets('falhou mostra o selo e o erro, sem estourar a largura', (t) async {
      await montar(t, estado: 'falhou', erro: 'Guarita não respondeu');
      expect(find.text('NÃO FOI POSSÍVEL GRAVAR NO PORTÃO'), findsOneWidget);
      expect(find.text('Guarita não respondeu'), findsOneWidget);
      expect(t.takeException(), isNull);
    });

    testWidgets('o erro só aparece em falhou', (t) async {
      await montar(t, estado: 'ativo', erro: 'resto antigo');
      expect(find.text('resto antigo'), findsNothing);
    });
  });
}
