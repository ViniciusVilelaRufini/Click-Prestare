/// Categorias do módulo financeiro — fonte única.
///
/// Antes estavam duplicadas em new_financeiro_morador, morador_financeiro_view
/// e list_financeiro; qualquer categoria nova exigia mexer em 4+ lugares e
/// era fácil divergir (aí o filtro de uma tela não achava a categoria da outra).
library;

import 'package:intl/intl.dart';

/// Categorias de contas pessoais do morador (sem "Condomínio", que é
/// reservada às cobranças geradas pelo síndico).
const kCategoriasPessoais = ["Aluguel", "Água", "Luz", "Internet", "Outros"];

/// Categorias disponíveis na cobrança criada pelo síndico.
const kCategoriasCobranca = ["Condomínio", "Aluguel", "Água", "Luz", "Internet", "Outros"];

/// Mês/ano a que um lançamento pertence — a regra que decide se ele aparece
/// quando o usuário troca o mês na tela.
class Competencia {
  /// Sempre com dois dígitos ("09"), que é o formato do seletor de mês.
  final String mes;
  final String ano;

  const Competencia(this.mes, this.ano);

  /// Compara com um mês/ano de seletor, tolerando "9" e "09" dos dois lados.
  bool pertenceAo(String mesAlvo, String anoAlvo) =>
      mes == mesAlvo.padLeft(2, '0') && ano == anoAlvo;
}

/// Extrai a competência de um lançamento, na ordem: data de vencimento →
/// campo `data` → "Ref. MM/AAAA" no nome → mês corrente.
///
/// Estava escrita quatro vezes, com divergências que produziam bug de verdade:
/// só uma cópia fazia `padLeft` no mês (sem ele, "5/9/2026" vira "9" e nunca
/// casa com o seletor "09" — o lançamento some da tela), e nenhuma tratava
/// data ISO, então o item caía no fallback e era jogado no mês corrente.
Competencia competenciaDe(dynamic item) {
  String bruto = item['data_vencimento']?.toString().trim() ?? '';
  if (bruto.isEmpty) bruto = item['data']?.toString().trim() ?? '';

  if (bruto.isNotEmpty) {
    // dd/MM/yyyy
    if (bruto.contains('/')) {
      final partes = bruto.split('/');
      if (partes.length >= 3) {
        return Competencia(partes[1].trim().padLeft(2, '0'), partes[2].trim());
      }
    }
    // ISO (yyyy-MM-dd, com ou sem hora)
    final iso = DateTime.tryParse(bruto);
    if (iso != null) {
      return Competencia(iso.month.toString().padLeft(2, '0'), iso.year.toString());
    }
  }

  final agora = DateTime.now();

  final nome = item['nome']?.toString() ?? '';
  if (nome.contains('Ref.')) {
    final ref = nome.split('Ref.').last.trim();
    final partes = ref.split('/');
    final mes = partes[0].trim();
    if (mes.isNotEmpty) {
      final ano = partes.length >= 2 ? partes[1].trim() : agora.year.toString();
      return Competencia(mes.padLeft(2, '0'), ano);
    }
  }

  return Competencia(agora.month.toString().padLeft(2, '0'), agora.year.toString());
}

/// Decide se uma cobrança órfã (sem `id_usuario`) é da unidade do morador,
/// comparando apartamento e bloco informados com o nome do lançamento.
///
/// Segue a mesma especificação de `FinanceiroService.nomeFaturaDeApto` do backend:
/// aceita sufixos como " - Taxa Condominial Ref. MM/AAAA", tolera blocos com
/// espaço ("Torre Norte") e condomínios de bloco único / sem bloco.
bool faturaDeAptoCorresponde(String nome, String meuApto, String meuBloco) {
  var apto = meuApto.trim();
  if (apto.toLowerCase().startsWith('apto ')) {
    apto = apto.substring(5).trim();
  }
  if (apto.isEmpty || nome.trim().isEmpty) return false;

  final aptoEsc = RegExp.escape(apto);
  final aptoRegex = RegExp(
    '\\b(?:Apto|Apartamento)\\s+$aptoEsc(?=\\s+Bloco\\s|\\s*[-–—]\\s|\$)',
    caseSensitive: false,
  );
  if (!aptoRegex.hasMatch(nome)) return false;

  var bloco = meuBloco.trim();
  if (bloco.toLowerCase().startsWith('bloco ')) {
    bloco = bloco.substring(6).trim();
  }

  if (bloco.isNotEmpty) {
    final blocoEsc = RegExp.escape(bloco);
    final blocoRegex = RegExp(
      '\\bBloco\\s+$blocoEsc(?=\\s*[-–—]\\s|\$)',
      caseSensitive: false,
    );
    return blocoRegex.hasMatch(nome);
  }

  // Sem bloco no perfil do morador: aceita apenas se a fatura também não tiver bloco
  return !RegExp(r'\bBloco\s+\S', caseSensitive: false).hasMatch(nome);
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

/// Define se o perfil tem permissão de ver/alternar entre finanças pessoais ("Meu Financeiro") e do condomínio.
///
/// Porteiros/funcionários só devem ver as finanças do condomínio (receitas e despesas),
/// nunca "Meu Financeiro". Síndicos podem alternar entre os dois. Moradores veem suas próprias contas.
bool deveExibirToggleFinanceiro(String userType) => userType == 'sindico';

/// Determina se o modo financeiro inicial deve ser o do condomínio para o perfil.
/// Funcionários e Síndicos iniciam em condomínio; apenas moradores em pessoal/morador.
bool isModoCondominioParaPerfil(String userType) => userType != 'morador';

/// Define se as contas pessoais do usuário devem ser requisitadas na API.
/// Funcionários não possuem contas pessoais no condomínio.
bool deveCarregarFinanceiroPessoal(String userType) => userType != 'funcionario';

