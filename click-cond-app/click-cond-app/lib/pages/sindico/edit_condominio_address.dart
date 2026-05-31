
import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/loader.dart';
import 'package:click/widgets/buttons/default_button.dart';
import 'package:flutter/material.dart';
import 'package:click/widgets/textfields/textfield_default.dart';
import 'package:click/widgets/navigation/navigation.dart';
import 'package:click/widgets/containers/box_main_rounded.dart';

class EditCondominioAddress extends StatefulWidget {
  const EditCondominioAddress({Key? key}) : super(key: key);

  get isEdit => null;

  @override
  _EditCondominioAddressPageState createState() => _EditCondominioAddressPageState();
}

class _EditCondominioAddressPageState extends State<EditCondominioAddress> {
  var _isLoading = false;
  
  final txtCep = TextEditingController();
  final txtPais = TextEditingController();
  final txtUF = TextEditingController();
  final txtCidade = TextEditingController();
  final txtBairro = TextEditingController();
  final txtRua = TextEditingController();
  final txtNumero = TextEditingController();
  final txtComplemento = TextEditingController();

  @override
  void initState(){
    super.initState();        
    load();
  }

  load() async{    
    try{
      changeLoading(true);
      var obj = await apiGetDetails("condominio/address", 0); 
      txtCep.text = obj["cep"] ?? "";
      txtPais.text = obj["pais"] ?? "";
      txtUF.text = obj["uf"] ?? "";
      txtCidade.text = obj["cidade"] ?? "";
      txtBairro.text = obj["bairro"] ?? "";
      txtRua.text = obj["rua"] ?? "";
      txtNumero.text = obj["numero"] ?? "";
      txtComplemento.text = obj["complemento"] ?? "";
      setState(() {});
    }catch(e){
      await displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      changeLoading(false);
    }
  }

  save() async{
    try{      
      changeLoading(true);
         
      await updateAddressCondominio(txtCep.text, txtRua.text, txtNumero.text, txtComplemento.text, txtBairro.text, txtCidade.text, txtUF.text, txtPais.text);
      await displayMessage(context, getText('alert_success'), getText('alert_dados_alterados'));
      Navigator.pop(context);
    } catch(e) {
      await displayMessage(context, getText('alert_error'), e.toString());
    } finally{
      changeLoading(false);
    }
  }

  changeLoading(bool value){
    _isLoading = value;
    setState(() {});
  }


  @override
  Widget build(BuildContext context) {

    var _pageSize = MediaQuery.of(context).size.height;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          Container(  
            decoration: BoxDecoration(
              color: Color.fromRGBO(0, 149, 218, 1),
            ),    
            child: Column(
              children: [
                NavigationDefault(title: getText('condominio_nav_edit')),
                Flexible(
                  child: SingleChildScrollView(
                    child: Container(
                      alignment: Alignment.center,
                      padding: const EdgeInsets.fromLTRB(25, 20, 25, 20), 
                      height: _pageSize >= 760 ? MediaQuery.of(context).size.height - 110 : 620,
                      decoration: BoxMainRounded(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.start,
                        children: [
                        TextFieldDefault(title: getText('signup_cond_cep'), keyboard: TextInputType.number, controller: txtCep),
                        SizedBox(height: 10),   
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Flexible(
                              child: TextFieldDefault(title: getText('signup_cond_pais'), controller: txtPais, textCapitalization: TextCapitalization.characters,),
                            ),
                            SizedBox(width: 10),   
                            Flexible(
                              child: TextFieldDefault(title: getText('signup_cond_uf'), controller: txtUF, textCapitalization: TextCapitalization.characters),
                            ),
                          ],
                        ),
                        TextFieldDefault(title: getText('signup_cond_cidade'), controller: txtCidade, textCapitalization: TextCapitalization.words),
                        SizedBox(height: 10),  
                        TextFieldDefault(title: getText('signup_cond_bairro'), controller: txtBairro, textCapitalization: TextCapitalization.words),
                        SizedBox(height: 10),   
                        TextFieldDefault(title: getText('signup_cond_rua'), controller: txtRua, textCapitalization: TextCapitalization.words),
                        SizedBox(height: 10),   
                        TextFieldDefault(title: getText('signup_cond_numero'), keyboard: TextInputType.number, controller: txtNumero),
                        SizedBox(height: 10),   
                        TextFieldDefault(title: getText('signup_cond_complemento'), controller: txtComplemento),
                          SizedBox(height: 10),
                          const SizedBox(height: 24),                                                       
                          DefaultButton(title: getText('btn_save'), hasArrow: false,                   
                            onPressed: () {
                              save();
                            }
                          ),
                        ],
                      ),
                    ),
                  )
                ),
              ],
            ), 
          ),
          if(_isLoading)
            const Loader(loadingTxt: '', opacity: 0.7, color: Colors.black, dismissibles: false)  
        ],
      )
    );
  }
}
