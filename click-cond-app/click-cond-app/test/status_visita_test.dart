import 'package:click/utils/status_visita.dart';
import 'package:click/widgets/app/cabecalho_pessoa.dart';
import 'package:flutter_test/flutter_test.dart';

/// Status da visita no app = a regra do console
/// (portaria-web core/status-visitante.util.ts). Antes o app olhava só a
/// janela de horário e mostrava AUTORIZADO para quem o console dizia
/// "Autorização expirada" (Rafael Costa, autorizado pelo morador há 12 dias).
void main() {
  final agora = DateTime.utc(2026, 11, 25, 15, 0);
  String iso(DateTime d) => d.toUtc().toIso8601String();
  String antes(Duration d) => iso(agora.subtract(d));
  String depois(Duration d) => iso(agora.add(d));

  Map<String, dynamic> janelaAberta([Map<String, dynamic> extra = const {}]) => {
        'liberado': 1,
        'is_prestador': 0,
        'data_hora_inicio': antes(const Duration(hours: 1)),
        'data_hora_termino': depois(const Duration(hours: 1)),
        ...extra,
      };

  group('statusVisita (port 1:1 do console)', () {
    test('autorização do morador de 12 dias atrás: não é autorizado', () {
      final v = {
        'liberado': 1,
        'is_prestador': 0,
        'auth_status': 'autorizado',
        'auth_solicitado_em': antes(const Duration(days: 12, minutes: 2)),
        'auth_respondido_em': antes(const Duration(days: 12)),
        'data_hora_inicio': antes(const Duration(days: 12)),
        'data_hora_termino': antes(const Duration(days: 11, hours: 20)),
      };
      expect(autorizacaoExpirada(v, agora), isTrue);
      // Sem o campo da API, a flag é derivada do registro (visita não usada).
      expect(statusVisita(v, agora), StatusVisita.expirado);
      final selo = statusPessoaDaVisita(v, agora);
      expect(selo, isNot(StatusPessoa.autorizado));
      expect(selo, StatusPessoa.expirado);
    });

    test('autorização do morador de 12 dias com janela ainda aberta: não é autorizado', () {
      // Mesmo se a janela cobrir hoje, sem liberado a autorização vencida não vale.
      final v = {
        'liberado': 0,
        'auth_status': 'autorizado',
        'auth_respondido_em': antes(const Duration(days: 12)),
        'data_hora_inicio': antes(const Duration(days: 12)),
        'data_hora_termino': depois(const Duration(days: 1)),
      };
      expect(statusPessoaDaVisita(v, agora), isNot(StatusPessoa.autorizado));
    });

    test('Rafael: liberado=1, janela larga aberta, autorização de 12 d (sem o campo da API): expirado', () {
      // O get-all do app não manda `autorizacao_expirada`; deriva-se como a API.
      final v = janelaAberta({
        'auth_status': 'autorizado',
        'auth_respondido_em': antes(const Duration(days: 12)),
        'data_hora_inicio': antes(const Duration(days: 12)),
      });
      expect(statusVisita(v, agora), StatusVisita.expirado);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.expirado);
      expect(visitaVencida(v, agora), isTrue);
      // Se a API mandar o campo explícito, ele manda.
      expect(statusVisita({...v, 'autorizacao_expirada': false}, agora), StatusVisita.autorizado);
    });

    test('pedido pendente recente: não é autorizado (aguardando)', () {
      final v = janelaAberta({
        'liberado': 0,
        'auth_status': 'pendente',
        'auth_solicitado_em': antes(const Duration(minutes: 2)),
      });
      expect(autorizacaoExpirada(v, agora), isFalse);
      expect(statusVisita(v, agora), isNot(StatusVisita.autorizado));
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.aguardando);
    });

    test('pedido pendente há 11 min: expirado', () {
      final v = janelaAberta({
        'liberado': 0,
        'auth_status': 'pendente',
        'auth_solicitado_em': antes(const Duration(minutes: 11)),
      });
      expect(autorizacaoExpirada(v, agora), isTrue);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.expirado);
    });

    test('liberado=1 dentro da janela: autorizado (int, string ou bool)', () {
      for (final lib in [1, '1', true]) {
        final v = janelaAberta({'liberado': lib});
        expect(statusVisita(v, agora), StatusVisita.liberado, reason: '$lib');
        expect(statusPessoaDaVisita(v, agora), StatusPessoa.autorizado, reason: '$lib');
      }
    });

    test('liberado=0 dentro da janela: finalizado', () {
      final v = janelaAberta({'liberado': 0});
      expect(statusVisita(v, agora), StatusVisita.saiu);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.finalizado);
    });

    test('início no futuro com liberado=1: agendado', () {
      final v = {
        'liberado': 1,
        'data_hora_inicio': depois(const Duration(hours: 2)),
        'data_hora_termino': depois(const Duration(hours: 4)),
      };
      expect(statusVisita(v, agora), StatusVisita.agendado);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.agendado);
    });

    test('presente: entrou e não saiu', () {
      final v = janelaAberta({
        'liberado': 0,
        'data_entrada': antes(const Duration(minutes: 30)),
        'data_saida': null,
        'auth_status': 'autorizado',
        'auth_respondido_em': antes(const Duration(days: 1)),
      });
      expect(statusVisita(v, agora), StatusVisita.presente);
      expect(autorizacaoExpirada(v, agora), isFalse);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.noLocal);
    });

    test('saiu, sem acesso contínuo: finalizado', () {
      final v = janelaAberta({
        'data_entrada': antes(const Duration(minutes: 40)),
        'data_saida': antes(const Duration(minutes: 10)),
      });
      expect(statusVisita(v, agora), StatusVisita.saiu);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.finalizado);
    });

    test('prestador liberado que saiu, dentro da janela (acesso contínuo): autorizado', () {
      final v = janelaAberta({
        'is_prestador': 1,
        'data_entrada': antes(const Duration(minutes: 40)),
        'data_saida': antes(const Duration(minutes: 10)),
      });
      expect(statusVisita(v, agora), StatusVisita.liberado);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.autorizado);
    });

    test('visitante recorrente (dias_semana) que saiu mantém a liberação', () {
      final v = janelaAberta({
        'dias_semana': '1,3,5',
        'data_entrada': antes(const Duration(minutes: 40)),
        'data_saida': antes(const Duration(minutes: 10)),
      });
      expect(statusVisita(v, agora), StatusVisita.liberado);
    });

    test('janela terminou há 5 min (tolerância de 15): ainda autorizado', () {
      final v = {
        'liberado': 1,
        'data_hora_inicio': antes(const Duration(hours: 2)),
        'data_hora_termino': antes(const Duration(minutes: 5)),
      };
      expect(janelaEncerrada(v, agora), isFalse);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.autorizado);
      expect(visitaVencida(v, agora), isFalse);
    });

    test('janela terminou há 20 min: finalizado (janela encerrada)', () {
      final v = {
        'liberado': 1,
        'data_hora_inicio': antes(const Duration(hours: 2)),
        'data_hora_termino': antes(const Duration(minutes: 20)),
      };
      expect(janelaEncerrada(v, agora), isTrue);
      expect(statusVisita(v, agora), StatusVisita.saiu);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.expirado);
      expect(visitaVencida(v, agora), isTrue);
    });

    test('flag autorizacao_expirada da API: expirado', () {
      final v = janelaAberta({'autorizacao_expirada': true});
      expect(statusVisita(v, agora), StatusVisita.expirado);
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.expirado);
    });

    test('pedido_expirado vindo da API: expirado', () {
      final v = janelaAberta({'liberado': 0, 'pedido_expirado': true});
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.expirado);
    });

    test('datas sem fuso e como DateTime são aceitas', () {
      final v = {
        'liberado': '1',
        'data_hora_inicio': agora.subtract(const Duration(hours: 1)),
        'data_hora_termino': agora.add(const Duration(hours: 1)),
      };
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.autorizado);
    });

    test('vencida: autorização do morador expirada sem uso esconde o PIN', () {
      final v = janelaAberta({
        'liberado': 0,
        'auth_status': 'autorizado',
        'auth_respondido_em': antes(const Duration(days: 12)),
      });
      expect(statusPessoaDaVisita(v, agora), StatusPessoa.expirado);
      expect(visitaVencida(v, agora), isTrue);
      expect(visitaVencida(janelaAberta(), agora), isFalse);
    });

    test('presente nunca é vencida, mesmo com a janela passada', () {
      final v = {
        'liberado': 1,
        'data_entrada': antes(const Duration(hours: 3)),
        'data_hora_termino': antes(const Duration(hours: 1)),
      };
      expect(visitaVencida(v, agora), isFalse);
    });
  });
}
