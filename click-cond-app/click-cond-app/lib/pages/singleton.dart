import 'package:click/main.dart';

class Singleton {
  static final Singleton _singleton = Singleton._internal();
  Singleton._internal();
  static Singleton get instance => _singleton;

  var id_condominio;
  var id_apartamento;
  // Nunca nulos: quatro telas (visitante, prestador, reserva, mudança) jogam
  // estes valores direto em TextEditingController.text, que não aceita null.
  // Eles só são preenchidos ao ABRIR um condomínio, então quem chegava nessas
  // telas direto da home — clicando num evento em "Meus Eventos", por exemplo —
  // batia em "type 'Null' is not a subtype of type 'String'". Quem lê já trata
  // string vazia; ninguém usa null como sinal de "não definido".
  var apartamento = '';
  var bloco = '';
  var condominio_nome = '';
  var condominio_photo = '';
  var apto_tipo; // vínculo do morador no apto: Proprietário/Inquilino/Membro/morador/null

  /// O morador logado é o "dono" do apto (pode cadastrar familiares)?
  /// Exige o vínculo explícito — a mesma regra do backend (insertFamiliar).
  /// Tratar vazio como dono mostrava o selo e o botão de familiar para quem
  /// o servidor depois recusava.
  bool isProprietarioApto() {
    final t = (apto_tipo ?? '').toString().toLowerCase().trim().replaceAll('á', 'a');
    return t == 'proprietario';
  }
  var vencimento_morador = "";
  var dias_restantes_morador = 10;
  var moeda = "R\$";

  MyAppState? mainView;

  getIdApartamento(){
    if(id_apartamento == null || id_apartamento < 1){
      return "";
    }else{
      return id_apartamento.toString();
    }
  }

  checkCurrentMoeda(String text){    
    return moeda == text;
  }

  getCurrentMoeda(){
    // Condomínios cadastrados com o código ISO ("BRL") exibiam "BRL 0,00".
    final m = moeda.trim();
    if (m.isEmpty || m.toUpperCase() == 'BRL') return "R\$";
    return m;
  }

  /// Limpa o estado em memória para evitar vazamento de apartamento/bloco
  /// e condomínio entre sessões no logout.
  void reset() {
    id_condominio = null;
    id_apartamento = null;
    apartamento = '';
    bloco = '';
    condominio_nome = '';
    condominio_photo = '';
    apto_tipo = null;
    vencimento_morador = '';
    dias_restantes_morador = 10;
    moeda = 'R\$';
    mainView = null;
  }
}
