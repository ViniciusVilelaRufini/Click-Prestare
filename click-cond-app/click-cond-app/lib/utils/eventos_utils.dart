/// Utilitários e regras de negócio para a seção de eventos e acessos.
library;

/// Retorna o título da seção de eventos na Home de acordo com o perfil do usuário.
/// Para 'funcionario', exibe 'Eventos do condomínio' pois o porteiro monitora os acessos
/// de todo o condomínio. Para moradores e outros perfis, exibe 'Meus eventos'.
String tituloSecaoEventos(String userType) {
  if (userType == 'funcionario') {
    return 'Eventos do condomínio';
  }
  return 'Meus eventos';
}
