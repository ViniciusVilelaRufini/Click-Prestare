import 'dart:convert';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/api_config.dart';
import 'package:click/utils/api_client.dart';

/// Consentimento LGPD do titular.
///
/// O estado vive no SERVIDOR, não no aparelho: é prova de consentimento e
/// precisa sobreviver a reinstalar o app e trocar de celular.

/// O que falta aceitar. Chamado no login e no bootstrap.
apiConsentimentoPendente() async {
  var url = ApiConfig.buildUri('/consentimentos/pendentes');
  try {
    var response = await ApiClient.get(url, headers: { "Authorization": getToken() });
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      return body is Map ? body : null;
    }
    return null;
  } catch (e) {
    // Sem resposta do servidor, NÃO bloqueia o app: deixar o morador preso
    // numa tela de aceite por causa de rede instável é pior que perguntar de
    // novo na próxima abertura.
    return null;
  }
}

apiRegistrarConsentimento({required bool privacidade, required bool biometria}) async {
  var url = ApiConfig.buildUri('/consentimentos');
  try {
    var response = await ApiClient.post(
      url,
      headers: { "Authorization": getToken(), "Content-Type": "application/json" },
      body: jsonEncode({ "privacidade": privacidade, "biometria": biometria }),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}
