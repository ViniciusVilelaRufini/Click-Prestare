import 'dart:async';
import 'dart:io' show FileSystemException;

import 'package:click/pages/singleton.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/utils/cond_cache.dart';
import 'package:click/utils/log.dart';
import 'package:click/utils/segredos_sessao.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:localstorage/localstorage.dart';

// Instância única — inicializada via ensureReady() no main antes de usar
final _storage = LocalStorage('user_data');

Future<void>? _prontoUmaVez;

/// Pode ser chamado de qualquer lugar e quantas vezes for: o startup e o
/// FirebaseService, a cada registro de push. A carga só roda uma vez; depois
/// dela o cache em memória é quem manda. A exceção é a leitura do Keystore que
/// falhou: aí a próxima chamada tenta de novo, senão a sessão salva só voltaria
/// reabrindo o app.
Future<void> ensureStorageReady() => _prontoUmaVez ??= _prepararStorage();

Future<void> _prepararStorage() async {
  var arquivoLido = true;
  try {
    await _storage.ready;
  } catch (e) {
    // JSON corrompido: o pacote segue com o mapa vazio e o próximo flush
    // reescreve o arquivo. O boot não pode depender deste arquivo.
    arquivoLido = false;
    logDebug('[LocalStorage] user_data ilegível: ${e.runtimeType}');
  }
  // Token e dispositivo confiável vivem no armazenamento seguro (fora do
  // JSON em texto puro e do backup). O legado serve para migrar e de reserva.
  SegredosSessao.legado = LegadoSessao(
    ler: (k) => _storage.getItem(k),
    gravar: (k, v) => _persistir(_storage.setItem(k, v)),
    apagar: (k) => _persistir(_storage.deleteItem(k)),
  );
  final leuTudo = await SegredosSessao.carregar();
  // Token sem nome e sem tipo de login é meia sessão: as telas escolheriam as
  // rotas erradas. Melhor pedir login, que grava tudo de novo.
  if (!arquivoLido && getToken().isNotEmpty && getUserType().isEmpty) {
    await SegredosSessao.apagar('token');
  }
  if (!leuTudo) _prontoUmaVez = null;
}

const _maxRegravacoes = 5;
bool _regravando = false;
bool _regravacaoPendente = false;

/// Quantas vezes o laço de regravação tentou gravar. Para testes.
@visibleForTesting
int debugRegravacoes = 0;

/// Acompanha uma gravação no arquivo do `localstorage`.
///
/// O pacote muda o mapa em memória na hora e grava o JSON inteiro num único
/// RandomAccessFile, que lança "An async operation is currently pending" se
/// outra gravação estiver em curso. Sem tratar, cada login soltava exceções não
/// capturadas, e a chave da gravação recusada podia não chegar ao disco. Na
/// recusa, grava de novo o estado atual em vez de repetir a chave: um logout no
/// meio do caminho não pode ver o dado apagado ressuscitar.
///
/// Termina assim que a gravação original termina: a regravação corre à parte,
/// com tentativas limitadas. Boot, logout e cache esperam por este Future, e um
/// disco com problema não pode prender nenhum deles.
Future<void> _persistir(Future<void> gravacao) async {
  try {
    await gravacao;
  } on FileSystemException catch (e) {
    logDebug('[LocalStorage] gravação recusada: ${e.message}');
    _regravacaoPendente = true;
    if (!_regravando) {
      _regravando = true;
      unawaited(_regravar());
    }
  } catch (e) {
    logDebug('[LocalStorage] falha ao gravar: ${e.runtimeType}');
  }
}

Future<void> _regravar() async {
  var tentativa = 0;
  while (_regravacaoPendente && tentativa < _maxRegravacoes) {
    _regravacaoPendente = false;
    await Future<void>.delayed(Duration(milliseconds: 50 << tentativa));
    tentativa++;
    debugRegravacoes++;
    try {
      // Remover uma chave que não existe só faz o pacote gravar o mapa atual.
      await _storage.deleteItem('__regravar__');
    } on FileSystemException catch (e) {
      logDebug('[LocalStorage] regravação recusada: ${e.message}');
      _regravacaoPendente = true;
    } catch (e) {
      logDebug('[LocalStorage] falha ao regravar: ${e.runtimeType}');
    }
  }
  if (_regravacaoPendente) {
    logDebug('[LocalStorage] desistindo de regravar depois de $tentativa tentativas');
    _regravacaoPendente = false;
  }
  _regravando = false;
}

void _guardar(String chave, dynamic valor) {
  _persistir(_storage.setItem(chave, valor));
}

/// Token de uma resposta de autenticação.
///
/// O login devolve em `token`; `/new-password` devolve em `access_token`.
/// Ler só um dos dois gravava null por cima do token bom.
String? tokenDaResposta(Map<String, dynamic> parsed) {
  for (final chave in const ['token', 'access_token']) {
    final valor = parsed[chave]?.toString().trim() ?? '';
    if (valor.isNotEmpty && valor != 'null') return valor;
  }
  return null;
}

/// Renova só o token, mantendo identidade e permissões da sessão atual.
///
/// Usado depois da troca de senha: a resposta de `/new-password` traz o
/// funcionário ANINHADO (`user.funcionario`) e sem as flags de permissão, ao
/// contrário do login. Reaproveitar storageMorador/storageFuncionario ali
/// zerava as 8 permissões e ainda trocava o loginType do porteiro.
void atualizarTokenSessao(Map<String, dynamic> parsed) {
  final token = tokenDaResposta(parsed);
  if (token != null) SegredosSessao.gravar('token', token);
}

storageLogin(Map<String, dynamic> parsed) {
  SegredosSessao.gravar('token', parsed["token"]?.toString());
  _guardar('id', parsed["user"]["id"]);
  _guardar('name', parsed["user"]["name"]);
  final photo = parsed["user"]["photo"]?.toString().trim() ?? '';
  _guardar('photo', photo);
  _inMemoryPhoto = photo;
  _guardar('loginType', 'sindico');
}

storageMorador(Map<String, dynamic> parsed) {
  SegredosSessao.gravar('token', parsed["token"]?.toString());
  _guardar('id', parsed["user"]["id"]);
  _guardar('name', parsed["user"]["nome"]);
  final photo = parsed["user"]["photo"]?.toString().trim() ?? '';
  _guardar('photo', photo);
  _inMemoryPhoto = photo;
  _guardar('loginType', 'morador');
}

storageFuncionario(Map<String, dynamic> parsed) {
  SegredosSessao.gravar('token', parsed["token"]?.toString());
  _guardar('id', parsed["user"]["id"]);
  _guardar('name', parsed["user"]["nome"]);
  final photo = parsed["user"]["photo"]?.toString().trim() ?? '';
  _guardar('photo', photo);
  _inMemoryPhoto = photo;
  _guardar('loginType', 'funcionario');

  _guardar('areas_sociais', parsed["user"]["areas_sociais"] ?? 0);
  _guardar('comunicados', parsed["user"]["comunicados"] ?? 0);
  _guardar('ocorrencias', parsed["user"]["ocorrencias"] ?? 0);
  _guardar('manutencoes_programadas', parsed["user"]["manutencoes_programadas"] ?? 0);
  _guardar('prestadores_servico', parsed["user"]["prestadores_servico"] ?? 0);
  _guardar('agendar_mudanca', parsed["user"]["agendar_mudanca"] ?? 0);
  _guardar('cadastrar_visitante', parsed["user"]["cadastrar_visitante"] ?? 0);
  _guardar('apartamentos', parsed["user"]["apartamentos"] ?? 0);
}

void storageAutoLogin(Map<String, dynamic> parsed, String loginType) {
  final cleanType = loginType.toLowerCase().trim();
  if (cleanType.contains('sindico')) {
    storageLogin(parsed);
  } else if (cleanType.contains('func')) {
    storageFuncionario(parsed);
  } else {
    storageMorador(parsed);
  }
}

Future<void> storageLogout() async {
  _inMemoryPhoto = '';
  // Cache de exibição do condomínio vive no processo, não no storage: sem isto
  // o próximo login veria o saldo/resumo do usuário anterior antes do refresh.
  CondCache.clear();
  _pendingCondCache.clear();
  Singleton.instance.reset();
  final deviceToken = getSindicoDeviceToken();
  final jwt = getToken();
  // A sessão local acaba agora, antes de qualquer espera. Quando isto vinha
  // depois do desregistro de push (rede, sem limite de tempo no deleteToken), a
  // HomePage aberta pelo 401 ainda via o token e entrava sozinha, e um login
  // feito nesse meio-tempo era apagado quando a espera terminava.
  final apagando = SegredosSessao.apagar('token');
  _persistir(_storage.clear());
  // O dispositivo confiável do MFA sobrevive ao logout (fica no armazenamento
  // seguro, que o clear acima não toca); regrava para garantir o cache.
  if (deviceToken.isNotEmpty) {
    setSindicoDeviceToken(deviceToken);
  }
  await apagando;
  try {
    await FirebaseService.instance.desregistrarNoServidor(jwt: jwt);
  } catch (_) {}
}

String getSindicoDeviceToken() {
  return SegredosSessao.ler('sindico_device_token');
}

void setSindicoDeviceToken(String token) {
  SegredosSessao.gravar('sindico_device_token', token);
}

String getToken() {
  return SegredosSessao.ler('token');
}

String getUsername() {
  final name = _storage.getItem('name');
  if (name == null) return "";
  return name.toString().split(" ")[0];
}

String getUserFullName() {
  final name = _storage.getItem('name');
  if (name == null || name == 'null') return "";
  return name.toString().trim();
}

String _inMemoryPhoto = '';

String getUserPhoto() {
  if (_inMemoryPhoto.isNotEmpty) return _inMemoryPhoto;
  final photo = _storage.getItem('photo');
  if (photo == null || photo == 'null' || photo == 'undefined' || photo.toString().trim().isEmpty) {
    return '';
  }
  _inMemoryPhoto = photo.toString().trim();
  return _inMemoryPhoto;
}

void setUserPhoto(String url) {
  final clean = url.trim();
  if (clean.isNotEmpty && clean != 'null' && clean != 'undefined') {
    _inMemoryPhoto = clean;
    _guardar('photo', clean);
  }
}

String getUserType() {
  return _storage.getItem('loginType') ?? '';
}

getUserPermission(String permission) {
  return _storage.getItem(permission) ?? 0;
}

String getUserId() {
  return _storage.getItem('id')?.toString() ?? "";
}

bool _isSavingCondCache = false;
final Map<int, Map<String, dynamic>> _pendingCondCache = {};

void saveCondCachePersistent(int id, Map<String, dynamic> json) {
  // Resposta que chegou depois do logout: os dados não têm mais dono no aparelho.
  if (getToken().isEmpty) return;
  _pendingCondCache[id] = json;
  if (_isSavingCondCache) return;
  _isSavingCondCache = true;
  Future.delayed(const Duration(milliseconds: 100), () async {
    try {
      while (_pendingCondCache.isNotEmpty) {
        final key = _pendingCondCache.keys.first;
        final val = _pendingCondCache.remove(key);
        await _persistir(_storage.setItem('cond_cache_$key', val));
      }
    } finally {
      _isSavingCondCache = false;
    }
  });
}

Map<String, dynamic>? getCondCachePersistent(int id) {
  try {
    final item = _storage.getItem('cond_cache_$id');
    if (item is Map) {
      return Map<String, dynamic>.from(item);
    }
  } catch (_) {}
  return null;
}
