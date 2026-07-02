/// Categorias do módulo financeiro — fonte única.
///
/// Antes estavam duplicadas em new_financeiro_morador, morador_financeiro_view
/// e list_financeiro; qualquer categoria nova exigia mexer em 4+ lugares e
/// era fácil divergir (aí o filtro de uma tela não achava a categoria da outra).
library financeiro_constants;

/// Categorias de contas pessoais do morador (sem "Condomínio", que é
/// reservada às cobranças geradas pelo síndico).
const kCategoriasPessoais = ["Aluguel", "Água", "Luz", "Internet", "Outros"];

/// Categorias disponíveis na cobrança criada pelo síndico.
const kCategoriasCobranca = ["Condomínio", "Aluguel", "Água", "Luz", "Internet", "Outros"];
