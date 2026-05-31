
import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/loader.dart';
import 'package:click/widgets/buttons/default_button.dart';
import 'package:easy_mask/easy_mask.dart';
import 'package:flutter/material.dart';
import 'package:click/widgets/textfields/textfield_default.dart';
import 'package:click/widgets/navigation/navigation.dart';
import 'package:click/widgets/containers/box_main_rounded.dart';
import 'package:material_design_icons_flutter/material_design_icons_flutter.dart';

class EditCondominioDados extends StatefulWidget {
  const EditCondominioDados({Key? key}) : super(key: key);

  get isEdit => null;

  @override
  _EditCondominioDadosPageState createState() => _EditCondominioDadosPageState();
}

class _EditCondominioDadosPageState extends State<EditCondominioDados> {
  var _isLoading = false;
  var changed = false;

  dynamic imageFile;
  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtSubsindico = TextEditingController();
  final txtInicioMandato = TextEditingController();
  final txtTerminoMandato = TextEditingController();

  @override
  void initState(){
    super.initState();        
    load();
  }

  load() async{    
    try{
      changeLoading(true);
      var obj = await apiGetDetails("condominio/infos", 0); 
      txtNome.text = obj["nome"] ?? "";
      txtDocumento.text = obj["identificacao"] ?? "";
      txtSubsindico.text = obj["subsindico_nome"] ?? "";
      txtInicioMandato.text = obj["data_inicio_mandato"] ?? "";
      txtTerminoMandato.text = obj["data_termino_mandato"] ?? "";
      imageFile = await fileFromImageUrl(obj["photo"] ?? "");
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
      
      var base64 = null;
      if(imageFile != null && changed == true){
        List<int> imageBytes = [];
        base64 = "data:image/png;base64,"+base64Encode(imageBytes);
      }
      await updateInfosCondominio(txtNome.value.text, txtDocumento.value.text, txtSubsindico.value.text, 
                                    txtInicioMandato.value.text.trim(), txtTerminoMandato.value.text, base64);          
      await displayMessage(context, getText('alert_success'), getText('alert_dados_alterados'));
      Navigator.pop(context);
    } catch(e) {
      await displayMessage(context, getText('alert_error'), e.toString());
    } finally{
      changeLoading(false);
    }
  }

  void selectCamera()async {
    var res = await getPhoto(context);
    imageFile = res;
    changed = true;
    setState(() {});
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
                NavigationDefault(title: getText('condominio_nav_edit_address')),
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
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              InkWell(
                                onTap: (){selectCamera();},
                                child: Stack(
                                  children: [
                                    CircleAvatar(
                                      backgroundColor: Colors.white,
                                      radius: 55,
                                      backgroundImage: 
                                          imageFile == null
                                        ? const AssetImage('assets/images/business_default.png')
                                        : Image.network(imageFile.path).image,
                                    ),
                                    Container(
                                      padding: EdgeInsets.fromLTRB(80, 80, 0, 0),
                                      child: Icon(MdiIcons.camera, color: Theme.of(context).primaryColor),
                                    )
                                  ],
                                ),
                              ),
                            ],
                          ),
                          TextFieldDefault(title: getText('signup_cond_nome'), controller: txtNome),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('user_documento'), controller: txtDocumento),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('signup_cond_subsindico_nome'), controller: txtSubsindico),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('signup_cond_ini_mandato'), keyboard: TextInputType.number, controller: txtInicioMandato, mask: TextInputMask(mask: ['99/99/9999'],reverse: false)),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('signup_cond_fim_mandato'), keyboard: TextInputType.number, controller: txtTerminoMandato, mask: TextInputMask(mask: ['99/99/9999'],reverse: false)),
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
