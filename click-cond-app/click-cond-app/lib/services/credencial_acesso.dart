import 'dart:async';
import 'dart:convert';

import 'package:click/controllers/controller_credencial.dart';
import 'package:click/services/biometric_auth_service.dart';
import 'package:click/utils/codigo_dinamico.dart' as formato;
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;

enum SituacaoCredencial { pronta, indisponivelNoCondominio, semMorador, semInternetNaPrimeiraVez, erro }

/// Credencial guardada no aparelho. `deltaMs` = hora do servidor − relógio do
/// aparelho, medida na última resposta da API.
class CredencialLocal {
  final int id;
  final List<int> segredo;
  final int deltaMs;

  const CredencialLocal({required this.id, required this.segredo, required this.deltaMs});

  // Sem o segredo: este objeto pode acabar num print de depuração.
  @override
  String toString() => 'CredencialLocal(id: $id)';
}

typedef ResultadoPreparo = ({SituacaoCredencial situacao, CredencialLocal? credencial});

/// Aviso de que a conferência em segundo plano mudou algo: credencial trocada
/// (outro aparelho emitiu uma nova), hora corrigida, ou opção desligada.
typedef AoAtualizarCredencial = void Function(SituacaoCredencial situacao, CredencialLocal? credencial);

/// Credencial do QR de "Meu acesso".
///
/// O segredo é emitido pela API uma vez (`renovar: true`) e guardado no
/// armazenamento seguro, em `cred_acesso_<idCondominio>`. Com ele o app gera o
/// código sozinho, sem internet. A cada abertura da tela, se houver rede, a
/// API é consultada em segundo plano para: perceber que outro aparelho trocou
/// a credencial (o `id` muda), corrigir a diferença de hora e saber se a opção
/// foi desligada.
///
/// O segredo nunca vai para log, print, analytics ou crash report.
class CredencialAcesso {
  /// O mesmo armazenamento seguro do token da sessão ([SegredosSessao]),
  /// salvo quando trocado (testes).
  static SecureStorageInterface get armazenamento => _armazenamento ?? SegredosSessao.armazenamento;
  static set armazenamento(SecureStorageInterface valor) => _armazenamento = valor;
  static SecureStorageInterface? _armazenamento;

  static Future<Map<String, dynamic>> Function(int, {bool renovar}) chamar = apiCredencialMinha;
  static DateTime Function() agora = DateTime.now;

  static const _prefixoChave = 'cred_acesso_';

  /// Muda a cada esquecer: a conferência que voltar depois não regrava.
  static final Map<int, int> _versoes = {};
  static int _epoca = 0;

  /// A conferência em segundo plano da última chamada a [preparar]. Para testes.
  @visibleForTesting
  static Future<void>? atualizacaoEmCurso;

  static String _chave(int idCondominio) => '$_prefixoChave$idCondominio';

  static Future<ResultadoPreparo> preparar(int idCondominio, {AoAtualizarCredencial? aoAtualizar}) async {
    final guardada = await _ler(idCondominio);
    if (guardada != null) {
      atualizacaoEmCurso = _conferir(idCondominio, guardada, aoAtualizar);
      return (situacao: SituacaoCredencial.pronta, credencial: guardada);
    }
    atualizacaoEmCurso = null;
    return _emitir(idCondominio, _marca(idCondominio));
  }

  static String codigoAtual(CredencialLocal c) => formato.gerarCodigoDinamico(
        id: c.id,
        contador: formato.contadorDe(_horaCorrigida(c)),
        segredo: c.segredo,
      );

  static int segundosAteTrocar(CredencialLocal c) => formato.segundosAteTrocar(_horaCorrigida(c));

  static Future<void> esquecer(int idCondominio) async {
    _versoes[idCondominio] = (_versoes[idCondominio] ?? 0) + 1;
    try {
      await armazenamento.delete(key: _chave(idCondominio));
    } catch (_) {}
  }

  /// Logout: apaga as credenciais de todos os condomínios deste aparelho. Só a
  /// do condomínio ativo não basta: o próximo usuário do aparelho veria, por
  /// um instante, o QR de quem saiu em outro condomínio.
  static Future<void> esquecerTodas() async {
    _epoca++;
    try {
      final todas = await armazenamento.readAll();
      for (final chave in todas.keys.where((k) => k.startsWith(_prefixoChave))) {
        await armazenamento.delete(key: chave);
      }
    } catch (_) {}
  }

  static DateTime _horaCorrigida(CredencialLocal c) => agora().add(Duration(milliseconds: c.deltaMs));

  static (int, int) _marca(int idCondominio) => (_epoca, _versoes[idCondominio] ?? 0);

  static bool _valeAinda(int idCondominio, (int, int) marca) => marca == _marca(idCondominio);

  /// Pede segredo novo. Sem rede, nada é guardado.
  static Future<ResultadoPreparo> _emitir(int idCondominio, (int, int) marca) async {
    final antes = agora();
    final resposta = await _chamar(idCondominio, renovar: true);
    final depois = agora();

    if (resposta['disponivel'] == false) {
      if (_valeAinda(idCondominio, marca)) await _apagar(idCondominio);
      return (situacao: _situacaoIndisponivel(resposta['motivo']), credencial: null);
    }
    if (resposta['erro'] != null || resposta['disponivel'] != true) {
      final semRede = resposta['sem_conexao'] == true;
      return (
        situacao: semRede ? SituacaoCredencial.semInternetNaPrimeiraVez : SituacaoCredencial.erro,
        credencial: null,
      );
    }

    final id = _inteiro(resposta['id']);
    final hex = resposta['segredo'];
    if (id == null || hex is! String) return (situacao: SituacaoCredencial.erro, credencial: null);
    final List<int> segredo;
    try {
      segredo = formato.segredoDeHex(hex);
    } on FormatException {
      return (situacao: SituacaoCredencial.erro, credencial: null);
    }

    final nova = CredencialLocal(id: id, segredo: segredo, deltaMs: _delta(resposta, antes, depois) ?? 0);
    if (_valeAinda(idCondominio, marca)) await _gravar(idCondominio, nova, hex);
    return (situacao: SituacaoCredencial.pronta, credencial: nova);
  }

  /// Conferência em segundo plano de uma credencial já guardada.
  static Future<void> _conferir(
    int idCondominio,
    CredencialLocal guardada,
    AoAtualizarCredencial? aoAtualizar,
  ) async {
    final marca = _marca(idCondominio);
    try {
      final antes = agora();
      final resposta = await _chamar(idCondominio, renovar: false);
      final depois = agora();
      if (!_valeAinda(idCondominio, marca)) return;

      if (resposta['disponivel'] == false) {
        await _apagar(idCondominio);
        aoAtualizar?.call(_situacaoIndisponivel(resposta['motivo']), null);
        return;
      }
      // Sem rede ou erro do servidor: segue com o que está guardado.
      if (resposta['disponivel'] != true) return;

      if (_inteiro(resposta['id']) != guardada.id) {
        // Outro aparelho emitiu uma credencial nova e a guardada foi revogada.
        // Falha de rede ou do servidor no meio: fica a guardada até a próxima.
        final r = await _emitir(idCondominio, marca);
        final falhou =
            r.situacao == SituacaoCredencial.semInternetNaPrimeiraVez || r.situacao == SituacaoCredencial.erro;
        if (!falhou && _valeAinda(idCondominio, marca)) aoAtualizar?.call(r.situacao, r.credencial);
        return;
      }

      final delta = _delta(resposta, antes, depois);
      if (delta == null || delta == guardada.deltaMs) return;
      final corrigida = CredencialLocal(id: guardada.id, segredo: guardada.segredo, deltaMs: delta);
      await _gravar(idCondominio, corrigida, _hex(guardada.segredo));
      aoAtualizar?.call(SituacaoCredencial.pronta, corrigida);
    } catch (_) {
      // Conferência é oportunista: falha aqui não derruba a tela.
    }
  }

  static Future<Map<String, dynamic>> _chamar(int idCondominio, {required bool renovar}) async {
    try {
      return await chamar(idCondominio, renovar: renovar);
    } catch (_) {
      return {'erro': 'Sem conexão com a internet.', 'sem_conexao': true};
    }
  }

  static SituacaoCredencial _situacaoIndisponivel(dynamic motivo) =>
      motivo == 'sem_morador' ? SituacaoCredencial.semMorador : SituacaoCredencial.indisponivelNoCondominio;

  /// Hora do servidor − relógio do aparelho, tomando o meio da chamada.
  static int? _delta(Map<String, dynamic> resposta, DateTime antes, DateTime depois) {
    final texto = resposta['agora_servidor'];
    if (texto is! String) return null;
    final servidor = DateTime.tryParse(texto);
    if (servidor == null) return null;
    final meio = (antes.millisecondsSinceEpoch + depois.millisecondsSinceEpoch) ~/ 2;
    return servidor.millisecondsSinceEpoch - meio;
  }

  static int? _inteiro(dynamic v) {
    if (v is int) return v;
    if (v is num && v == v.roundToDouble()) return v.toInt();
    if (v is String) return int.tryParse(v);
    return null;
  }

  static Future<CredencialLocal?> _ler(int idCondominio) async {
    String? bruto;
    try {
      bruto = await armazenamento.read(key: _chave(idCondominio));
    } catch (_) {
      return null;
    }
    if (bruto == null || bruto.isEmpty) return null;
    try {
      final m = jsonDecode(bruto);
      final id = m is Map ? _inteiro(m['id']) : null;
      final hex = m is Map ? m['segredo'] : null;
      final delta = m is Map ? _inteiro(m['delta_ms']) : null;
      if (id == null || hex is! String) throw const FormatException();
      return CredencialLocal(id: id, segredo: formato.segredoDeHex(hex), deltaMs: delta ?? 0);
    } catch (_) {
      // Valor ilegível: descarta e emite de novo.
      await _apagar(idCondominio);
      return null;
    }
  }

  static Future<void> _gravar(int idCondominio, CredencialLocal c, String hex) async {
    try {
      await armazenamento.write(
        key: _chave(idCondominio),
        value: jsonEncode({'id': c.id, 'segredo': hex.toLowerCase(), 'delta_ms': c.deltaMs}),
      );
    } catch (_) {
      // Keystore indisponível: a credencial vale nesta abertura e é emitida de
      // novo na próxima.
    }
  }

  static Future<void> _apagar(int idCondominio) async {
    try {
      await armazenamento.delete(key: _chave(idCondominio));
    } catch (_) {}
  }

  static String _hex(List<int> bytes) => bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}
