import 'package:click/controllers/controller_generic.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/loader.dart';
import 'package:click/widgets/buttons/default_button_normal.dart';
import 'package:click/widgets/buttons/upload_button.dart';
import 'package:flutter/material.dart';

class ModalFinalizarAssembleia extends StatefulWidget {

  const ModalFinalizarAssembleia({
    super.key, required this.assembleia, 
    });
    final dynamic assembleia;

  @override
  _ModalFinalizarAssembleiaState createState() => _ModalFinalizarAssembleiaState();
}

class _ModalFinalizarAssembleiaState extends State<ModalFinalizarAssembleia> {
  var _isLoading = false;
  List<dynamic> list = [];

  save() async{
    try{
      if(list.isEmpty){
        displayMessage(context, getText('alert_error'), getText('assembleia_alert_ata'));
        return;
      }
      changeLoading(true);      
      String base64 = '';
      for(var item in list){
        base64 = convertToBase64(item, 'application/pdf');
      }
      var obj = FinalizarAssembleiaModel(
        id: widget.assembleia['id'],
        titulo: widget.assembleia['titulo'],
        data: widget.assembleia['data'],
        doc: base64,
      );
      var res = await apiSaveObject("assembleias/finish", "assembleia", obj, false);
      changeLoading(false);
      if(res.toString().isEmpty){
        await displayMessageWithReturn(context, getText('alert_success'), getText('assembleia_encerrada'));
        Navigator.of(context).pop();
        Navigator.of(context).pop();
      }else{
        displayMessage(context, getText('alert_error'), res.toString());
      }
    }catch(e){
      changeLoading(false);
      displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    }
  }

  changeLoading(bool value){
    _isLoading = value;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(5),
      ),
      elevation: 0,
      backgroundColor: Colors.transparent,
      child: contentBox(context),
    );
  }
  contentBox(context){
    return Stack(
      children: <Widget>[
        Container(
          padding: EdgeInsets.all(20),
          margin: EdgeInsets.only(top: 25),
          decoration: BoxDecoration(
            shape: BoxShape.rectangle,
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(color: Colors.black,offset: Offset(0,5),
              blurRadius: 15
              ),
            ]
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  InkWell(
                    onTap: (){
                      Navigator.of(context).pop();
                    },
                    child: Text(
                      'X',
                      style: TextStyle(
                        color: Colors.black,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              Text(getText('assembleia_finalize_upload'),  textAlign: TextAlign.center, style: TextStyle(fontSize: 22,fontWeight: FontWeight.w900, color: Theme.of(context).hintColor),),
              SizedBox(height: 25,),
              uploadFile(title: getText('assembleia_upload_ata'), types: ['pdf'], maxDocs: 1,
                onPressed: (listFiles){
                  list = listFiles;
                },
              ),
              SizedBox(height: 35,),
              DefaultButtonNormal(
                  title: getText('btn_save'), hasArrow: false,
                  onPressed: () {
                    save();
                  }
              ),
            ],
          ),
        ),
        if(_isLoading)
            SizedBox(
              height: 1000,
              width: 1000,
              child: const Loader(loadingTxt: '', opacity: 0.7, color: Colors.black, dismissibles: false)
            )
      ],
    );
  }
}



class FinalizarAssembleiaModel{
  int? id;
  String? titulo;
  String? data;
  String? doc;

  FinalizarAssembleiaModel({
    this.id,
    this.titulo,
    this.data,
    this.doc,
  });

  Map toJson() => {
    'id': id,
    'titulo': titulo,
    'data': data,
    'doc': doc,
  };
}
