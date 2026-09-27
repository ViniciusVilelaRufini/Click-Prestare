import 'dart:convert';

import 'package:click/models/delivery_model.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/api_config.dart';

class DeliveryResult {
  final bool success;
  final DeliveryModel? delivery;
  final String? message;

  const DeliveryResult._({required this.success, this.delivery, this.message});

  factory DeliveryResult.ok(DeliveryModel delivery) =>
      DeliveryResult._(success: true, delivery: delivery);

  factory DeliveryResult.error(String message) =>
      DeliveryResult._(success: false, message: message);
}

class DeliveryListResult {
  final List<DeliveryModel> deliveries;
  final String? message;

  const DeliveryListResult._({required this.deliveries, this.message});

  factory DeliveryListResult.ok(List<DeliveryModel> deliveries) =>
      DeliveryListResult._(deliveries: deliveries);

  factory DeliveryListResult.error(String message) =>
      DeliveryListResult._(deliveries: const [], message: message);
}

class DeliveryUnitsResult {
  final List<DeliveryUnit> units;
  final String? message;

  const DeliveryUnitsResult._({required this.units, this.message});

  factory DeliveryUnitsResult.ok(List<DeliveryUnit> units) =>
      DeliveryUnitsResult._(units: units);

  factory DeliveryUnitsResult.error(String message) =>
      DeliveryUnitsResult._(units: const [], message: message);
}

Future<DeliveryUnitsResult> apiGetDeliveryUnits({int? idCondominio}) async {
  final condominiumId =
      idCondominio ?? _asInt(Singleton.instance.id_condominio);
  if (condominiumId == null || condominiumId < 1) {
    return DeliveryUnitsResult.error(
        'Selecione um condomínio para consultar suas unidades.');
  }

  try {
    final response = await ApiClient.get(
      ApiConfig.buildUri(
          '/delivery/unidades', {'id_condominio': condominiumId.toString()}),
    );
    if (response.statusCode != 200) {
      return DeliveryUnitsResult.error(mensagemDeErroApi(response.body));
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! List) {
      return DeliveryUnitsResult.error('A resposta das unidades é inválida.');
    }
    final units = decoded
        .whereType<Map>()
        .map((item) => DeliveryUnit.fromJson(Map<String, dynamic>.from(item)))
        .where((unit) => unit.id > 0 && unit.apto.isNotEmpty)
        .toList();
    return DeliveryUnitsResult.ok(units);
  } catch (_) {
    return DeliveryUnitsResult.error(
        'Não foi possível carregar suas unidades. Verifique a conexão e tente novamente.');
  }
}

Future<DeliveryListResult> apiGetDeliveries({int? idCondominio}) async {
  final condominiumId =
      idCondominio ?? _asInt(Singleton.instance.id_condominio);
  if (condominiumId == null || condominiumId < 1) {
    return DeliveryListResult.error(
        'Selecione um condomínio para consultar os avisos.');
  }

  try {
    final response = await ApiClient.get(ApiConfig.buildUri(
        '/delivery', {'id_condominio': condominiumId.toString()}));
    if (response.statusCode != 200) {
      return DeliveryListResult.error(mensagemDeErroApi(response.body));
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! List) {
      return DeliveryListResult.error('A resposta dos avisos é inválida.');
    }
    return DeliveryListResult.ok(
      decoded
          .whereType<Map>()
          .map(
              (item) => DeliveryModel.fromJson(Map<String, dynamic>.from(item)))
          .toList(),
    );
  } catch (_) {
    return DeliveryListResult.error(
        'Não foi possível carregar os avisos. Verifique a conexão e tente novamente.');
  }
}

Future<DeliveryResult> apiCreateDelivery(
  DeliveryDraft draft, {
  int? idCondominio,
  int? idApartamento,
}) async {
  final condominiumId =
      idCondominio ?? _asInt(Singleton.instance.id_condominio);
  final apartmentId =
      idApartamento ?? _asInt(Singleton.instance.id_apartamento);
  if (condominiumId == null ||
      apartmentId == null ||
      condominiumId < 1 ||
      apartmentId < 1) {
    return DeliveryResult.error('Não foi possível identificar sua unidade.');
  }

  try {
    final response = await ApiClient.post(
      ApiConfig.buildUri('/delivery'),
      body: jsonEncode(draft.toCreateJson(
          idCondominio: condominiumId, idApartamento: apartmentId)),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return DeliveryResult.error(mensagemDeErroApi(response.body));
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      return DeliveryResult.error('A resposta ao criar o aviso é inválida.');
    }
    return DeliveryResult.ok(
        DeliveryModel.fromJson(Map<String, dynamic>.from(decoded)));
  } catch (_) {
    return DeliveryResult.error(
        'Não foi possível criar o aviso. Verifique a conexão e tente novamente.');
  }
}

Future<DeliveryResult> apiCancelDelivery(DeliveryModel delivery) async {
  if (delivery.id == null || !delivery.canCancel) {
    return DeliveryResult.error(
        'Somente avisos agendados podem ser cancelados.');
  }

  try {
    final response = await ApiClient.patch(
      ApiConfig.buildUri('/delivery/${delivery.id}'),
      body: jsonEncode(
          {'status': 'CANCELADA', 'motivo': 'Cancelado pelo morador.'}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return DeliveryResult.error(mensagemDeErroApi(response.body));
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      return DeliveryResult.error('A resposta ao cancelar o aviso é inválida.');
    }
    return DeliveryResult.ok(
        DeliveryModel.fromJson(Map<String, dynamic>.from(decoded)));
  } catch (_) {
    return DeliveryResult.error(
        'Não foi possível cancelar o aviso. Verifique a conexão e tente novamente.');
  }
}

int? _asInt(dynamic value) =>
    value is num ? value.toInt() : int.tryParse(value?.toString() ?? '');
