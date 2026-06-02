import 'package:click/main.dart';

class Singleton {
  static final Singleton _singleton = new Singleton._internal();
  Singleton._internal();
  static Singleton get instance => _singleton;

  var id_condominio;
  var id_apartamento;
  var apartamento;
  var bloco;
  var apto_tipo; // vínculo do morador no apto: Proprietário/Inquilino/Membro/morador/null

  /// O morador logado é o "dono" do apto (pode cadastrar familiares)?
  /// Dados legados usam tipos inconsistentes; tratamos como proprietário tudo que
  /// NÃO for explicitamente Inquilino/dependente/Membro.
  bool isProprietarioApto() {
    final t = (apto_tipo ?? '').toString().toLowerCase().trim();
    if (t.isEmpty) return true;
    return !(t == 'inquilino' || t == 'dependente' || t == 'membro');
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
    return moeda.isEmpty ? "R\$" : moeda;
  }
}
