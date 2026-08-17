import 'package:click/services/firebase_service.dart';
import 'package:localstorage/localstorage.dart';

// Instância única — inicializada via ensureReady() no main antes de usar
final _storage = LocalStorage('user_data');

/// Deve ser chamado uma vez no startup (já feito em LocalStorageConfig.initializeLocalStorage)
Future<void> ensureStorageReady() async {
  await _storage.ready;
}

storageLogin(Map<String, dynamic> parsed) {
  _storage.setItem('token', parsed["token"]);
  _storage.setItem('id', parsed["user"]["id"]);
  _storage.setItem('name', parsed["user"]["name"]);
  final photo = parsed["user"]["photo"]?.toString().trim() ?? '';
  _storage.setItem('photo', photo);
  _inMemoryPhoto = photo;
  _storage.setItem('loginType', 'sindico');
}

storageMorador(Map<String, dynamic> parsed) {
  _storage.setItem('token', parsed["token"]);
  _storage.setItem('id', parsed["user"]["id"]);
  _storage.setItem('name', parsed["user"]["nome"]);
  final photo = parsed["user"]["photo"]?.toString().trim() ?? '';
  _storage.setItem('photo', photo);
  _inMemoryPhoto = photo;
  _storage.setItem('loginType', 'morador');
}

storageFuncionario(Map<String, dynamic> parsed) {
  _storage.setItem('token', parsed["token"]);
  _storage.setItem('id', parsed["user"]["id"]);
  _storage.setItem('name', parsed["user"]["nome"]);
  final photo = parsed["user"]["photo"]?.toString().trim() ?? '';
  _storage.setItem('photo', photo);
  _inMemoryPhoto = photo;
  _storage.setItem('loginType', 'funcionario');

  _storage.setItem('areas_sociais', parsed["user"]["areas_sociais"] ?? 0);
  _storage.setItem('comunicados', parsed["user"]["comunicados"] ?? 0);
  _storage.setItem('ocorrencias', parsed["user"]["ocorrencias"] ?? 0);
  _storage.setItem('manutencoes_programadas', parsed["user"]["manutencoes_programadas"] ?? 0);
  _storage.setItem('prestadores_servico', parsed["user"]["prestadores_servico"] ?? 0);
  _storage.setItem('agendar_mudanca', parsed["user"]["agendar_mudanca"] ?? 0);
  _storage.setItem('cadastrar_visitante', parsed["user"]["cadastrar_visitante"] ?? 0);
  _storage.setItem('apartamentos', parsed["user"]["apartamentos"] ?? 0);
}

Future<void> storageLogout() async {
  _inMemoryPhoto = '';
  try {
    await FirebaseService.instance.desregistrarNoServidor();
  } catch (_) {}
  _storage.clear();
}

String getToken() {
  return _storage.getItem('token') ?? "";
}

String getUsername() {
  final name = _storage.getItem('name');
  if (name == null) return "";
  return name.toString().split(" ")[0];
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
    _storage.setItem('photo', clean);
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
