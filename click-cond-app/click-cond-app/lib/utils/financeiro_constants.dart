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

/// "Apto 10 - Bloco A" → ('10', 'A'). Devolve null se o nome não é fatura de
/// apartamento. O bloco pode ter espaços ("Torre Norte").
final _padraoFaturaApto = RegExp(
  r'^\s*apto\s+(\S+)\s*[-–—]?\s*bloco\s+(.+?)\s*$',
  caseSensitive: false,
);

/// Decide se uma cobrança órfã (sem `id_usuario`) é da unidade do morador,
/// comparando apartamento e bloco extraídos do nome do lançamento.
///
/// Antes isto era `nome.contains('apto $meuApto')`, que casa por prefixo: para
/// quem mora no Apto 10, "Apto 101" e "Apto 1050" também batiam, e a dívida do
/// vizinho entrava no total do morador. Comparação exata, campo a campo.
bool faturaDeAptoCorresponde(String nome, String meuApto, String meuBloco) {
  final apto = meuApto.trim().toLowerCase();
  final bloco = meuBloco.trim().toLowerCase();
  if (apto.isEmpty || bloco.isEmpty) return false;

  final m = _padraoFaturaApto.firstMatch(nome);
  if (m == null) return false;

  return m.group(1)!.trim().toLowerCase() == apto && m.group(2)!.trim().toLowerCase() == bloco;
}

/// Totais de uma lista de lançamentos do financeiro.
class TotaisFinanceiro {
  final double pago;
  final double pendente;
  final int contasPagas;
  final int totalContas;

  const TotaisFinanceiro({
    required this.pago,
    required this.pendente,
    required this.contasPagas,
    required this.totalContas,
  });
}

/// Soma os lançamentos usando [parseValorMoeda] e [isPagoValor].
///
/// As telas faziam esta conta inline, cada uma com o seu parse: a do morador
/// usava `double.tryParse` cru, que devolve null para "1.250,75" — o `?? 0`
/// engolia a parcela e o "Total pendente" aparecia menor do que a dívida real,
/// sem nenhum aviso. Uma conta só, no mesmo lugar.
TotaisFinanceiro totaisFinanceiro(List<dynamic> itens) {
  double pago = 0;
  double pendente = 0;
  int contasPagas = 0;

  for (final item in itens) {
    final valor = parseValorMoeda(item['valor']);
    if (isPagoValor(item['pago'])) {
      pago += valor;
      contasPagas++;
    } else {
      pendente += valor;
    }
  }

  return TotaisFinanceiro(
    pago: pago,
    pendente: pendente,
    contasPagas: contasPagas,
    totalContas: itens.length,
  );
}

/// Interpreta o campo `pago`, que a API devolve ora como int (1), ora como
/// String ("1").
///
/// Comparar `item['pago'] == 1` direto faz uma conta quitada parecer pendente
/// sempre que o valor vier como texto — e, nos modais de edição, salvar em
/// seguida gravava `pago: 0` por cima. Só o 1 conta como pago.
bool isPagoValor(dynamic valor) {
  if (valor is num) return valor == 1;
  return valor?.toString().trim() == '1';
}

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
