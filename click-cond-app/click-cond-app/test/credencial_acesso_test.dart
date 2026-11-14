import 'dart:convert';

import 'package:click/services/biometric_auth_service.dart';
import 'package:click/services/credencial_acesso.dart';
import 'package:click/utils/codigo_dinamico.dart';
import 'package:flutter_test/flutter_test.dart';

/// "Meu acesso" gera o QR no próprio aparelho, a partir de um segredo emitido
/// pela API uma vez e guardado no armazenamento seguro. A API devolve também a
/// hora do servidor, para o app corrigir relógio errado.
class _SeguroFalso implements SecureStorageInterface {
  final Map<String, String> dados = {};
  bool falharLeitura = false;

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value == null) {
      dados.remove(key);
    } else {
      dados[key] = value;
    }
  }

  @override
  Future<String?> read({required String key}) async {
    if (falharLeitura) throw Exception('keystore indisponível');
    return dados[key];
  }

  @override
  Future<void> delete({required String key}) async => dados.remove(key);

  @override
  Future<Map<String, String>> readAll() async => Map.of(dados);
}

class _Chamada {
  final int idCondominio;
  final bool renovar;
  _Chamada(this.idCondominio, this.renovar);
}

const _hexA = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const _hexB = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

void main() {
  late _SeguroFalso seguro;
  late List<_Chamada> chamadas;
  late List<Map<String, dynamic>> respostas;
  late DateTime relogio;

  // Hora "do servidor" nas respostas: a hora certa.
  final horaCerta = DateTime.utc(2026, 11, 14, 12, 0, 0);

  Map<String, dynamic> emitida(int id, String hex, {DateTime? agora}) => {
        'disponivel': true,
        'id': id,
        'segredo': hex,
        'intervalo_s': 30,
        'agora_servidor': (agora ?? horaCerta).toIso8601String(),
      };

  Map<String, dynamic> ativa(int id, {DateTime? agora}) => {
        'disponivel': true,
        'id': id,
        'intervalo_s': 30,
        'agora_servidor': (agora ?? horaCerta).toIso8601String(),
      };

  const semRede = {'erro': 'Sem conexão com a internet.', 'sem_conexao': true};

  setUp(() {
    seguro = _SeguroFalso();
    chamadas = [];
    respostas = [];
    relogio = horaCerta;
    CredencialAcesso.armazenamento = seguro;
    CredencialAcesso.agora = () => relogio;
    CredencialAcesso.chamar = (int id, {bool renovar = false}) async {
      chamadas.add(_Chamada(id, renovar));
      return respostas.isEmpty ? Map<String, dynamic>.from(semRede) : respostas.removeAt(0);
    };
  });

  Map<String, dynamic> guardado(int idCondominio) =>
      jsonDecode(seguro.dados['cred_acesso_$idCondominio']!) as Map<String, dynamic>;

  test('primeira vez com rede: pede renovar, guarda e devolve pronta', () async {
    respostas.add(emitida(7, _hexA));

    final r = await CredencialAcesso.preparar(10);

    expect(r.situacao, SituacaoCredencial.pronta);
    expect(r.credencial!.id, 7);
    expect(r.credencial!.segredo, segredoDeHex(_hexA));
    expect(chamadas.single.idCondominio, 10);
    expect(chamadas.single.renovar, isTrue);
    expect(guardado(10), {'id': 7, 'segredo': _hexA, 'delta_ms': 0});
    expect(
      CredencialAcesso.codigoAtual(r.credencial!),
      gerarCodigoDinamico(id: 7, contador: contadorDe(horaCerta), segredo: segredoDeHex(_hexA)),
    );
  });

  test('primeira vez sem rede: semInternetNaPrimeiraVez e nada guardado', () async {
    final r = await CredencialAcesso.preparar(10);

    expect(r.situacao, SituacaoCredencial.semInternetNaPrimeiraVez);
    expect(r.credencial, isNull);
    expect(seguro.dados, isEmpty);
  });

  test('primeira vez com erro do servidor: erro, nada guardado', () async {
    respostas.add({'erro': 'Acesso negado ao condomínio.'});

    final r = await CredencialAcesso.preparar(10);

    expect(r.situacao, SituacaoCredencial.erro);
    expect(seguro.dados, isEmpty);
  });

  test('com credencial guardada e sem rede: pronta, gera código offline', () async {
    seguro.dados['cred_acesso_10'] = jsonEncode({'id': 7, 'segredo': _hexA, 'delta_ms': 0});

    final r = await CredencialAcesso.preparar(10);
    await CredencialAcesso.atualizacaoEmCurso;

    expect(r.situacao, SituacaoCredencial.pronta);
    expect(r.credencial!.id, 7);
    // A conferência em segundo plano não pede segredo novo.
    expect(chamadas.single.renovar, isFalse);
    expect(guardado(10)['id'], 7);
    expect(CredencialAcesso.codigoAtual(r.credencial!), startsWith('P1'));
    expect(CredencialAcesso.codigoAtual(r.credencial!).length, 28);
  });

  test('relógio do aparelho 5 minutos adiantado: codigoAtual usa a hora corrigida (Review Focus 3)', () async {
    relogio = horaCerta.add(const Duration(minutes: 5));
    respostas.add(emitida(7, _hexA));

    final r = await CredencialAcesso.preparar(10);

    expect(r.credencial!.deltaMs, -300000);
    expect(guardado(10)['delta_ms'], -300000);
    final esperado =
        gerarCodigoDinamico(id: 7, contador: contadorDe(horaCerta), segredo: segredoDeHex(_hexA));
    expect(CredencialAcesso.codigoAtual(r.credencial!), esperado);

    // Sem a correção, o código seria o de 10 intervalos à frente: negado como vencido.
    final semCorrecao =
        gerarCodigoDinamico(id: 7, contador: contadorDe(relogio), segredo: segredoDeHex(_hexA));
    expect(esperado, isNot(semCorrecao));
  });

  test('credencial guardada com relógio errado é corrigida na próxima chamada com internet', () async {
    seguro.dados['cred_acesso_10'] = jsonEncode({'id': 7, 'segredo': _hexA, 'delta_ms': 0});
    relogio = horaCerta.add(const Duration(minutes: 5));
    respostas.add(ativa(7));
    CredencialLocal? atualizada;

    final r = await CredencialAcesso.preparar(10, aoAtualizar: (s, c) => atualizada = c);
    await CredencialAcesso.atualizacaoEmCurso;

    expect(r.credencial!.deltaMs, 0);
    expect(atualizada!.deltaMs, -300000);
    expect(guardado(10)['delta_ms'], -300000);
    expect(
      CredencialAcesso.codigoAtual(atualizada!),
      gerarCodigoDinamico(id: 7, contador: contadorDe(horaCerta), segredo: segredoDeHex(_hexA)),
    );
  });

  test('segundosAteTrocar usa a hora corrigida', () async {
    // Aparelho 10 s atrasado: no servidor já são 12:00:10, faltam 20 s.
    relogio = horaCerta.subtract(const Duration(seconds: 10));
    respostas.add(emitida(7, _hexA, agora: horaCerta));

    final r = await CredencialAcesso.preparar(10);
    relogio = horaCerta; // 10 s depois, no relógio do aparelho

    expect(CredencialAcesso.segundosAteTrocar(r.credencial!), 20);
  });

  test('servidor devolve outro id: renova e substitui a guardada', () async {
    seguro.dados['cred_acesso_10'] = jsonEncode({'id': 7, 'segredo': _hexA, 'delta_ms': 0});
    respostas.add(ativa(9));
    respostas.add(emitida(11, _hexB));
    final avisos = <(SituacaoCredencial, CredencialLocal?)>[];

    final r = await CredencialAcesso.preparar(10, aoAtualizar: (s, c) => avisos.add((s, c)));
    await CredencialAcesso.atualizacaoEmCurso;

    expect(r.credencial!.id, 7);
    expect(chamadas.map((c) => c.renovar).toList(), [false, true]);
    expect(guardado(10), {'id': 11, 'segredo': _hexB, 'delta_ms': 0});
    expect(avisos.last.$1, SituacaoCredencial.pronta);
    expect(avisos.last.$2!.id, 11);
    expect(avisos.last.$2!.segredo, segredoDeHex(_hexB));
  });

  test('servidor devolve disponivel false: apaga a guardada', () async {
    seguro.dados['cred_acesso_10'] = jsonEncode({'id': 7, 'segredo': _hexA, 'delta_ms': 0});
    respostas.add({'disponivel': false, 'motivo': 'opcao_desligada'});
    final avisos = <SituacaoCredencial>[];

    await CredencialAcesso.preparar(10, aoAtualizar: (s, c) => avisos.add(s));
    await CredencialAcesso.atualizacaoEmCurso;

    expect(seguro.dados.containsKey('cred_acesso_10'), isFalse);
    expect(avisos, [SituacaoCredencial.indisponivelNoCondominio]);
  });

  test('primeira vez com disponivel false: devolve o motivo e não guarda', () async {
    respostas.add({'disponivel': false, 'motivo': 'sem_morador'});
    expect((await CredencialAcesso.preparar(10)).situacao, SituacaoCredencial.semMorador);

    respostas.add({'disponivel': false, 'motivo': 'opcao_desligada'});
    expect((await CredencialAcesso.preparar(10)).situacao,
        SituacaoCredencial.indisponivelNoCondominio);
    expect(seguro.dados, isEmpty);
  });

  test('valor guardado corrompido é tratado como primeira vez', () async {
    seguro.dados['cred_acesso_10'] = '{"id": "x"';
    respostas.add(emitida(7, _hexA));

    final r = await CredencialAcesso.preparar(10);

    expect(r.situacao, SituacaoCredencial.pronta);
    expect(chamadas.single.renovar, isTrue);
    expect(guardado(10)['id'], 7);
  });

  test('esquecer apaga a chave do condomínio e só ela', () async {
    seguro.dados['cred_acesso_10'] = jsonEncode({'id': 7, 'segredo': _hexA, 'delta_ms': 0});
    seguro.dados['cred_acesso_20'] = jsonEncode({'id': 8, 'segredo': _hexB, 'delta_ms': 0});
    seguro.dados['token'] = 'jwt';

    await CredencialAcesso.esquecer(10);

    expect(seguro.dados.keys.toSet(), {'cred_acesso_20', 'token'});
  });

  test('esquecerTodas (logout) apaga as credenciais de todos os condomínios e nada mais', () async {
    seguro.dados['cred_acesso_10'] = jsonEncode({'id': 7, 'segredo': _hexA, 'delta_ms': 0});
    seguro.dados['cred_acesso_20'] = jsonEncode({'id': 8, 'segredo': _hexB, 'delta_ms': 0});
    seguro.dados['token'] = 'jwt';
    seguro.dados['bio_login_x'] = 'y';

    await CredencialAcesso.esquecerTodas();

    expect(seguro.dados.keys.toSet(), {'token', 'bio_login_x'});
  });

  test('conferência em segundo plano que volta depois do esquecer não regrava', () async {
    seguro.dados['cred_acesso_10'] = jsonEncode({'id': 7, 'segredo': _hexA, 'delta_ms': 0});
    respostas.add(ativa(7, agora: horaCerta.add(const Duration(seconds: 3))));

    await CredencialAcesso.preparar(10);
    await CredencialAcesso.esquecer(10);
    await CredencialAcesso.atualizacaoEmCurso;

    expect(seguro.dados.containsKey('cred_acesso_10'), isFalse);
  });
}
