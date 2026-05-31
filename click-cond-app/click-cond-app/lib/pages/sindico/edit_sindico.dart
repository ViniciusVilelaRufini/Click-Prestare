
import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/loader.dart';
import 'package:click/widgets/buttons/default_button.dart';
import 'package:easy_mask/easy_mask.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:click/widgets/textfields/textfield_default.dart';
import 'package:click/widgets/navigation/navigation.dart';
import 'package:click/widgets/containers/box_main_rounded.dart';
import 'package:material_design_icons_flutter/material_design_icons_flutter.dart';

class EditSindico extends StatefulWidget {
  const EditSindico({Key? key}) : super(key: key);

  get isEdit => null;

  @override
  _EditSindicoPageState createState() => _EditSindicoPageState();
}

class _EditSindicoPageState extends State<EditSindico> {
  dynamic imageFile;
  var _isLoading = false;
  var changed = false;

  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtDN = TextEditingController();
  final txtEmail = TextEditingController();
  final txtTelefone = TextEditingController();
  final txtPassword = TextEditingController();

  @override
  void initState(){
    super.initState();        
    load();
  }

  load() async{    
    try{
      changeLoading(true);
      var obj = await apiGetDetails("sindico", 0); 
      txtNome.text = obj["name"] ?? "";
      txtEmail.text = obj["email"] ?? "";
      txtDN.text = obj["date_birth"] ?? "";
      txtTelefone.text = obj["phone"] ?? "";
      txtDocumento.text = obj["doc_identification"] ?? "";
      imageFile = await fileFromImageUrl(getUserPhoto());
      setState(() {});
    }catch(e){
      await displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      changeLoading(false);
    }
  }

  void selectCamera()async {
    var res = await getPhoto(context);
    imageFile = res;
    changed = true;
    setState(() {});
  }

  save() async{
    try{
      if(!validateDate(txtDN.value.text)){
        displayMessage(context, getText('alert_error'), getText('signup_erro_dt_nascimento'));
        return;
      }
      changeLoading(true);
      
      var base64 = null;
      if(imageFile != null && changed == true){
        List<int> imageBytes = [];
        base64 = "data:image/png;base64,"+base64Encode(imageBytes);
      }
      await updateSindico(txtNome.value.text, txtDocumento.value.text, txtDN.value.text, 
                                        txtEmail.value.text.trim(), txtTelefone.value.text, base64);          
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
                NavigationDefault(title: getText('sindico_nav_edit')),
                Flexible(
                  child: SingleChildScrollView(
                    child: Container(
                      alignment: Alignment.center,
                      padding: const EdgeInsets.fromLTRB(25, 20, 25, 20), 
                      constraints: BoxConstraints(
                        minHeight: MediaQuery.of(context).size.height - 110,
                      ),
                      decoration: BoxMainRounded(),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              InkWell(
                                onTap: (){selectCamera();},
                                child: Stack(
                                  children: [
                                    CircleAvatar(                      
                                      radius: 55,
                                      backgroundImage: imageFile == null
                                        ? const AssetImage('assets/images/defaultUser.png')
                                        : (kIsWeb ? NetworkImage(imageFile!.path) : const AssetImage('assets/images/defaultUser.png')) as ImageProvider,
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
                          TextFieldDefault(title: getText('user_nome_completo'), controller: txtNome,  textCapitalization: TextCapitalization.words,),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('user_documento'), controller: txtDocumento),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('data_nascimento'), keyboard: TextInputType.number, controller: txtDN, mask: TextInputMask(mask: ['99/99/9999'], reverse: false)),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('email'), controller: txtEmail, keyboard: TextInputType.emailAddress),
                          SizedBox(height: 10),   
                          TextFieldDefault(title: getText('telefone'), keyboard: TextInputType.number, controller: txtTelefone),
                          SizedBox(height: 10),   
                          // TextFieldDefault(title: "Senha", isPassword: true, controller: txtPassword),
                          // SizedBox(height: 10),  
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
                // SaveButton(isEdit: false, 
                //   onPressedDelete:  (){print('');} , 
                //   onPressedSave:  (){signup();} 
                // ),
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
