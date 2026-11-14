import 'package:click/utils/rotulo_bloco.dart';
String buildVisitorAccessInvite({
  required String condominioNome,
  required String bloco,
  required String apartamento,
  required String autorizadoPor,
  required String codigo,
  String? visitanteNome,
  String? tipoPessoa,
  String? periodo,
  String? passeUrl,
}) {
  final nomeCondominio =
      condominioNome.trim().isEmpty ? 'Condominio' : condominioNome.trim();
  final nomeAutorizador =
      autorizadoPor.trim().isEmpty ? 'Morador' : autorizadoPor.trim();

  final sb = StringBuffer();
  sb.writeln('🎫 *Convite de Acesso - Prestare*\n');
  sb.writeln('🏢 *Condomínio:* $nomeCondominio\n');

  if (visitanteNome != null && visitanteNome.trim().isNotEmpty) {
    sb.writeln('Olá, *${visitanteNome.trim()}*!');
    sb.writeln('Sua liberação de acesso ao condomínio está confirmada.\n');
  } else {
    sb.writeln('Olá! Sua liberação de acesso foi cadastrada.\n');
  }

  final destino = [
    if (bloco.trim().isNotEmpty && bloco.trim() != 'null') rotuloBloco(bloco),
    if (apartamento.trim().isNotEmpty) 'Apto ${apartamento.trim()}',
  ].join(', ');
  if (destino.isNotEmpty) {
    sb.writeln('📍 *Destino:* $destino');
  }

  sb.writeln('👤 *Autorizado por:* $nomeAutorizador');

  if (tipoPessoa != null && tipoPessoa.trim().isNotEmpty) {
    sb.writeln('👥 *Tipo:* ${tipoPessoa.trim()}');
  }

  if (periodo != null && periodo.trim().isNotEmpty) {
    sb.writeln('⏰ *Horário / Período Liberado:* ${periodo.trim()}');
  }

  sb.writeln('🔑 *Código de Acesso (PIN):* $codigo\n');

  // Link do passe: a página mostra um QR que muda a cada 30 s. O PIN não sai
  // mais da Prestare para virar imagem em serviço de terceiro.
  final link = passeUrl?.trim() ?? '';
  if (link.isNotEmpty) {
    sb.writeln('📲 *Passe de acesso (QR):*');
    sb.writeln('Abra o link ao chegar e mostre o QR no leitor:');
    sb.writeln(link);
    sb.writeln();
    sb.write('Se preferir, informe o PIN na portaria.');
    return sb.toString();
  }

  sb.write('Informe este código ao chegar na portaria para liberação da sua entrada.');
  return sb.toString();
}
