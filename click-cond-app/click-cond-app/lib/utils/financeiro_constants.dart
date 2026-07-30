/// Categorias do módulo financeiro — fonte única.
///
/// Antes estavam duplicadas em new_financeiro_morador, morador_financeiro_view
/// e list_financeiro; qualquer categoria nova exigia mexer em 4+ lugares e
/// era fácil divergir (aí o filtro de uma tela não achava a categoria da outra).
library financeiro_constants;

import 'package:intl/intl.dart';

/// Categorias de contas pessoais do morador (sem "Condomínio", que é
/// reservada às cobranças geradas pelo síndico).
const kCategoriasPessoais = ["Aluguel", "Água", "Luz", "Internet", "Outros"];

/// Categorias disponíveis na cobrança criada pelo síndico.
const kCategoriasCobranca = ["Condomínio", "Aluguel", "Água", "Luz", "Internet", "Outros"];

/// Lê um valor monetário digitado no app, aceitando BR e US.
///
/// O ponto só é separador de MILHAR quando existe uma vírgula na string
/// ("1.250,75"). Sozinho, ele é decimal ("1250.75") e precisa ser preservado.
///
/// Isso importava muito: os formulários preenchiam o campo com o número cru
/// que a API devolve (`obj['valor'].toString()` → "1250.75") e depois faziam
/// `replaceAll('.', '')` na hora de salvar. O ponto decimal sumia e uma
/// cobrança de R$ 1.250,75 era salva como R$ 125.075,00 — bastava o síndico
/// abrir um lançamento com centavos e apertar Salvar sem mudar nada. Mesma
/// regra do parseValorMonetario do backend.
double parseValorMoeda(dynamic bruto) {
  if (bruto is num) return bruto.toDouble();
  var texto = (bruto ?? '').toString().replaceAll(RegExp(r'[^0-9,.\-]'), '').trim();
  if (texto.isEmpty) return 0;
  if (texto.contains(',')) {
    texto = texto.replaceAll('.', '').replaceAll(',', '.');
  }
  return double.tryParse(texto) ?? 0;
}

/// Formata um valor vindo da API para o texto que o campo de moeda espera
/// ("1.250,75"). O CurrencyTextInputFormatter só roda quando o usuário digita;
/// texto atribuído por código passa direto e precisa já vir formatado.
String valorParaInput(dynamic bruto) {
  final valor = parseValorMoeda(bruto).abs();
  if (valor == 0) return '';
  return formatMoeda(valor);
}

/// Número em formato brasileiro, SEM símbolo — quem exibe concatena a moeda do
/// condomínio (`Singleton.getCurrentMoeda()`).
///
/// Os totais calculados na tela usavam `toStringAsFixed(2)`, que devolve o
/// formato americano: o card "Total Pendente" do morador mostrava
/// "R$ 1250.75" em vez de "R$ 1.250,75" — logo no número de maior destaque da
/// tela. Os valores linha a linha não tinham esse problema porque vêm
/// prontos da API (`valorReal`).
String formatMoeda(dynamic bruto) {
  return NumberFormat('#,##0.00', 'pt_BR').format(parseValorMoeda(bruto));
}
