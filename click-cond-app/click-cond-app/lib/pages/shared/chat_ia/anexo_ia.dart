import 'package:click/utils/utils.dart';

/// Regras do anexo do Assistente IA, espelhando a API
/// (`apps/api/src/app/chat-ia/anexo-ia.ts`): só PDF, JPEG, PNG ou WEBP, até
/// 5 MB, com o tipo decidido pelos bytes — nome e extensão não valem. Checar
/// aqui evita mandar 6 MB de base64 só para ouvir o 400 de volta.
const int kMaxAnexoIaBytes = 5 * 1024 * 1024;

/// Mesmo texto do 400 da API, para o aviso não mudar conforme quem recusou.
const String kMsgAnexoIaRecusado = 'Arquivo não aceito: envie PDF ou imagem de até 5 MB.';

const Set<String> kMimesAnexoIa = {
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
};

/// Extensões oferecidas no seletor de arquivos.
const List<String> kExtensoesAnexoIa = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];

/// Tipo real do anexo pelos bytes, ou `null` se for grande demais ou de um
/// formato que a API recusa (GIF, HEIC, DOCX...).
String? mimeAceitoAnexoIa(List<int> bytes) {
  if (bytes.isEmpty || bytes.length > kMaxAnexoIaBytes) return null;
  final mime = detectarMime(bytes, '');
  return kMimesAnexoIa.contains(mime) ? mime : null;
}
