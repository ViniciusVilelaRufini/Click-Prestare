String buildVisitorAccessInvite({
  required String condominioNome,
  required String bloco,
  required String apartamento,
  required String autorizadoPor,
  required String codigo,
  String? visitanteNome,
  String? tipoPessoa,
  String? periodo,
  String? qrCodeUrl,
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
    if (bloco.trim().isNotEmpty && bloco.trim() != 'null') 'Bloco ${bloco.trim()}',
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

  if (qrCodeUrl != null && qrCodeUrl.trim().isNotEmpty) {
    sb.writeln('📲 *QR Code de Acesso:*');
    sb.writeln('Acesse o link abaixo para visualizar seu QR Code:');
    sb.writeln('${qrCodeUrl.trim()}\n');
  }

  sb.write('Apresente este código ou o QR Code ao chegar na portaria para liberação da sua entrada.');
  return sb.toString();
}
