import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:click/utils/api_config.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/api_client.dart';

final _kTimeout = ApiConfig.timeout;

Uri _buildUri(String path) => ApiConfig.buildUri(path);

class SindicoLoginResult {
  final bool success;
  final bool mfaRequired;
  final String? mfaToken;
  final String? emailMasked;
  final int? expiresInSeconds;
  final String? errorMessage;

  const SindicoLoginResult({
    this.success = false,
    this.mfaRequired = false,
    this.mfaToken,
    this.emailMasked,
    this.expiresInSeconds,
    this.errorMessage,
  });
}

Future<SindicoLoginResult> loginSindico(String login, String password) async {
  try {
    final url = _buildUri('/sindico/login');
    final deviceToken = getSindicoDeviceToken();
    final headers = {
      "Content-Type": "application/json",
      if (deviceToken.isNotEmpty) "x-device-token": deviceToken,
    };
    final body = json.encode({
      'login': login,
      'password': password,
      if (deviceToken.isNotEmpty) 'device_token': deviceToken,
    });
    final response = await ApiClient
        .post(url,
            headers: headers, body: body,
            skip401Handling: true)
        .timeout(_kTimeout);

    final parsed = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 200) {
      if (parsed['mfa_required'] == true) {
        return SindicoLoginResult(
          mfaRequired: true,
          mfaToken: parsed['mfa_token']?.toString(),
          emailMasked: parsed['email_masked']?.toString(),
          expiresInSeconds: parsed['expires_in_seconds'] is int
              ? parsed['expires_in_seconds'] as int
              : int.tryParse(parsed['expires_in_seconds']?.toString() ?? '600') ?? 600,
        );
      }
      storageLogin(parsed);
      return const SindicoLoginResult(success: true);
    }
    return SindicoLoginResult(
      success: false,
      errorMessage: parsed["message"]?.toString() ?? "Houve um erro, tente novamente!",
    );
  } catch (e) {
    return const SindicoLoginResult(
      success: false,
      errorMessage: "Houve um erro, tente novamente!",
    );
  }
}

Future<String> verifyMfaCode(String mfaToken, String code, bool rememberDevice) async {
  try {
    final url = _buildUri('/auth/mfa/verify');
    final body = json.encode({
      'mfa_token': mfaToken,
      'code': code.trim(),
      'remember_device': rememberDevice,
    });
    final response = await ApiClient
        .post(url,
            headers: {"Content-Type": "application/json"},
            body: body,
            skip401Handling: true)
        .timeout(_kTimeout);

    final parsed = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 200 || response.statusCode == 201) {
      final deviceToken = parsed['device_token']?.toString();
      if (deviceToken != null && deviceToken.isNotEmpty && deviceToken != 'null') {
        setSindicoDeviceToken(deviceToken);
      }
      storageLogin(parsed);
      return "";
    }
    return parsed["message"]?.toString() ?? "Código inválido ou expirado.";
  } catch (e) {
    return "Houve um erro ao verificar o código. Tente novamente!";
  }
}

Future<Map<String, dynamic>> resendMfaCode(String mfaToken) async {
  try {
    final url = _buildUri('/auth/mfa/resend');
    final body = json.encode({'mfa_token': mfaToken});
    final response = await ApiClient
        .post(url,
            headers: {"Content-Type": "application/json"},
            body: body,
            skip401Handling: true)
        .timeout(_kTimeout);

    final parsed = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 200 || response.statusCode == 201) {
      return {
        'success': true,
        'mfa_token': parsed['mfa_token'],
        'email_masked': parsed['email_masked'],
        'expires_in_seconds': parsed['expires_in_seconds'] ?? 600,
        'message': parsed['message'] ?? 'Novo código enviado com sucesso!',
      };
    }
    return {
      'success': false,
      'message': parsed['message']?.toString() ?? 'Não foi possível reenviar o código.',
    };
  } catch (e) {
    return {
      'success': false,
      'message': 'Houve um erro de conexão ao reenviar o código.',
    };
  }
}

passRecoveryApi(String email, String loginType) async {
  final url = ApiConfig.buildUri('/$loginType/recovery-password');
  final body = json.encode({'email': email});
  try {
    final response = await ApiClient
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body,
            skip401Handling: true)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      return parsed["message"] ?? parsed["msg"] ?? "E-mail de recuperação enviado com sucesso!";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? parsed["msg"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    rethrow;
  }
}

Future<Map<String, dynamic>> solicitarCodigoRedefinicaoApi(
  String email,
  String loginType,
) async {
  final cleanLoginType = loginType.toLowerCase().contains('sindico')
      ? 'sindico'
      : (loginType.toLowerCase().contains('func') ? 'funcionarios' : 'moradores');
  final url = ApiConfig.buildUri('/$cleanLoginType/solicitar-codigo-redefinicao');
  final body = json.encode({'email': email.trim()});

  try {
    final response = await ApiClient.post(
      url,
      headers: {"Content-Type": "application/json"},
      body: body,
      skip401Handling: true,
    ).timeout(_kTimeout);

    final parsed = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 200 && parsed['success'] == true) {
      return {
        'success': true,
        'ticket_id': parsed['ticket_id']?.toString() ?? '',
        'email_masked': parsed['email_masked']?.toString() ?? email,
        'expira_em_segundos': parsed['expira_em_segundos'] ?? 600,
        'message': parsed['message']?.toString() ?? 'Código de verificação enviado!',
      };
    }

    throw parsed['message']?.toString() ?? 'Não foi possível enviar o código de verificação.';
  } catch (e) {
    if (e is String) rethrow;
    throw 'Falha de comunicação com o servidor. Verifique sua conexão e tente novamente.';
  }
}

Future<String> validarCodigoRedefinicaoApi(
  String ticketId,
  String codigo, {
  String loginType = 'moradores',
}) async {
  final cleanLoginType = loginType.toLowerCase().contains('sindico')
      ? 'sindico'
      : (loginType.toLowerCase().contains('func') ? 'funcionarios' : 'moradores');
  final url = ApiConfig.buildUri('/$cleanLoginType/validar-codigo-redefinicao');
  final body = json.encode({
    'ticket_id': ticketId.trim(),
    'codigo': codigo.trim(),
  });

  try {
    final response = await ApiClient.post(
      url,
      headers: {"Content-Type": "application/json"},
      body: body,
      skip401Handling: true,
    ).timeout(_kTimeout);

    final parsed = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 200 && parsed['success'] == true && parsed['reset_token'] != null) {
      return parsed['reset_token'].toString();
    }

    throw parsed['message']?.toString() ?? 'Código inválido ou expirado.';
  } catch (e) {
    if (e is String) rethrow;
    throw 'Falha de comunicação com o servidor ao validar código.';
  }
}

Future<Map<String, dynamic>> redefinirSenhaComAutoLoginApi(
  String resetToken,
  String novaSenha,
  String loginType,
) async {
  final cleanLoginType = loginType.toLowerCase().contains('sindico')
      ? 'sindico'
      : (loginType.toLowerCase().contains('func') ? 'funcionarios' : 'moradores');
  final url = ApiConfig.buildUri('/$cleanLoginType/redefinir-senha');
  final body = json.encode({
    'token': resetToken.trim(),
    'nova_senha': novaSenha.trim(),
  });

  try {
    final response = await ApiClient.post(
      url,
      headers: {"Content-Type": "application/json"},
      body: body,
      skip401Handling: true,
    ).timeout(_kTimeout);

    final parsed = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 200 && parsed['success'] == true) {
      if (parsed['token'] != null && parsed['user'] != null) {
        storageAutoLogin(parsed, cleanLoginType);
      }
      return {
        'success': true,
        'message': parsed['message']?.toString() ?? 'Senha redefinida com sucesso!',
        'token': parsed['token'],
        'user': parsed['user'],
      };
    }

    throw parsed['message']?.toString() ?? 'Não foi possível redefinir a senha.';
  } catch (e) {
    if (e is String) rethrow;
    throw 'Falha de comunicação com o servidor ao salvar nova senha.';
  }
}

Future<String> redefinirSenhaApi(String token, String novaSenha) async {
  final url = ApiConfig.buildUri('/auth/redefinir-senha');
  final body = json.encode({
    'token': token,
    'nova_senha': novaSenha,
  });
  try {
    final response = await ApiClient.post(
      url,
      headers: {"Content-Type": "application/json"},
      body: body,
      skip401Handling: true,
    ).timeout(_kTimeout);

    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode == 200 && parsed['success'] == true) {
      return parsed['message'] ?? 'Senha redefinida com sucesso!';
    }
    throw parsed['message'] ?? 'Houve um erro ao redefinir a senha. Tente novamente.';
  } catch (e) {
    rethrow;
  }
}

signupSindico(String nome, String documento, String dn, String email,
    String telefone, String senha, String? photo) async {
  final url = _buildUri('/sindico/signup');
  final body = json.encode({
    "nome": nome,
    "email": email,
    "password": senha,
    "date_birth": dn,
    "phone": telefone,
    "doc_identification": documento,
    'photo': photo,
  });
  try {
    final response = await ApiClient
        .post(url,
            headers: {"Content-Type": "application/json"}, body: body,
            skip401Handling: true)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageLogin(parsed);
      return "";
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    return parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    return "Houve um erro, tente novamente!";
  }
}

updateSindico(String nome, String documento, String dn, String email,
    String telefone, String? photo) async {
  final url = _buildUri('/sindico/update');
  final body = json.encode({
    "nome": nome,
    "email": email,
    "date_birth": dn,
    "phone": telefone,
    "doc_identification": documento,
    'photo': photo,
  });
  try {
    final response = await ApiClient
        .post(url, body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      final parsed = jsonDecode(response.body) as Map<String, dynamic>;
      storageLogin(parsed);
      return;
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    rethrow;
  }
}

updatePasswordSindicoApi(String senhaAtual, String senha) async {
  final url = _buildUri('/sindico/new-password');
  final body = json.encode({"senha_atual": senhaAtual, "senha": senha});
  http.Response response;
  try {
    response = await ApiClient
        .post(url, body: body)
        .timeout(_kTimeout);
  } catch (e) {
    throw "Houve um erro, tente novamente!";
  }
  if (response.statusCode == 200) {
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    // Só o token é renovado: a resposta de /new-password não tem o mesmo
    // formato do login (ver atualizarTokenSessao em local_storage.dart).
    atualizarTokenSessao(parsed);
    return "";
  }
  // A mensagem do servidor precisa chegar na tela — "Senha atual incorreta."
  // não pode virar "houve um erro".
  throw mensagemDeErroApi(response.body);
}

// Vincula o próprio síndico logado como morador de um apartamento.
// Retorna o Map {id_condominio, apto_id, apto, apto_bloco, apto_tipo} em sucesso,
// ou lança a mensagem de erro do backend.
apiLinkSindicoMorador(dynamic idApartamento, String tipo) async {
  final url = _buildUri('/sindico/link-morador');
  final body = json.encode({'id_apartamento': idApartamento.toString(), 'tipo': tipo});
  try {
    final response = await ApiClient
        .post(url, body: body)
        .timeout(_kTimeout);
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    final parsed = jsonDecode(response.body) as Map<String, dynamic>;
    throw parsed["message"] ?? "Houve um erro, tente novamente!";
  } catch (e) {
    throw e is String ? e : "Houve um erro, tente novamente!";
  }
}
