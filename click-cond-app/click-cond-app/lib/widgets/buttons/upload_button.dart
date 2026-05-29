import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/utils/utils.dart';
import 'package:click/widgets/label/label_default.dart';
// import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:dotted_border/dotted_border.dart';
import 'package:file_picker/file_picker.dart';
import 'package:material_design_icons_flutter/material_design_icons_flutter.dart';

class uploadFile extends StatefulWidget {

  const uploadFile({
    Key? key,
    required this.title,
    required this.types,
    required this.maxDocs, 
    required this.onPressed,
    this.defaults
  }) : super(key: key);
  final String title;
  final List<String> types;
  final int maxDocs;
  final Function(List<dynamic>) onPressed;
  final List<dynamic>? defaults;

  @override
  _uploadFileState createState() => _uploadFileState();

}

class _uploadFileState extends State<uploadFile> {
  List<dynamic> list = [];

  @override
  void initState(){
    super.initState();
    list = widget.defaults ?? [];
  }

  removeAnexo(index){
    list.removeAt(index);
    widget.onPressed(list);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return DottedBorder(
      color: Colors.grey.shade600,
      strokeWidth: 1,
      padding: EdgeInsets.all(15),
      child: SizedBox(
        width: MediaQuery.of(context).size.width,
        height: 171,
        child: ElevatedButton(
          onPressed: () async{

            // Requesting permission
            // PermissionStatus status = await Permission.storage.request();
            // if (!status.isGranted) {
            //   displayMessage(context, getText('alert_ops'), "Você não concedeu permissão para o aplicativo acessar os seus arquivos.");
            //   // return;
            // }

            if(widget.maxDocs == list.length){
              displayMessage(context, "Alerta", "Número máximo de documentos atingidos");
              return;
            }

            FilePickerResult? result = await FilePicker.platform.pickFiles(
              type: FileType.custom,
              allowedExtensions: widget.types,
            );
            if (result != null) {
              list.add(result.files.single);
              widget.onPressed(list);
              setState(() {});
            } else {
              // User canceled the picker
            }
          }, 
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  for(var i=0; i<list.length; i++)
                    Column(
                      children: [
                        InkWell(
                          onTap: () {
                            if (!kIsWeb && list[i].path != null) {
                              openFile(list[i].path!);
                            }
                          },
                          child: Builder(
                            builder: (context) {
                              final String fileName = list[i].name.toLowerCase();
                              final bool isImage = fileName.endsWith('.jpg') ||
                                  fileName.endsWith('.jpeg') ||
                                  fileName.endsWith('.png');

                              if (isImage) {
                                if (kIsWeb) {
                                  if (list[i].bytes != null) {
                                    return Image.memory(
                                      list[i].bytes!,
                                      width: 80,
                                      height: 80,
                                      fit: BoxFit.cover,
                                    );
                                  }
                                } else if (list[i].path != null) {
                                  return Image.file(
                                    File(list[i].path!),
                                    width: 80,
                                    height: 80,
                                    fit: BoxFit.cover,
                                  );
                                }
                              }
                              return Icon(
                                MdiIcons.filePdfBox,
                                color: Theme.of(context).primaryColor,
                                size: 80,
                              );
                            },
                          ),
                        ),       
                        SizedBox(height: 10),
                        InkWell(
                          onTap: () {removeAnexo(i);},
                          child: Icon(Icons.delete_outline, size: 25, color: Theme.of(context).hintColor)
                        ),                       
                      ],
                    ),
                ],
              ),
              SizedBox(height: 20),
              LabelDefault(title: widget.title+' (${list.length}/${widget.maxDocs})', size: 15, maxLines: 2),
            ],
          ),
          style: ButtonStyle(
            elevation: MaterialStateProperty.all(0),
            backgroundColor: MaterialStateProperty.all<Color>(Colors.white),
            shape: MaterialStateProperty.all<RoundedRectangleBorder>(
              RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(5.0),
              )
            )
          )
        ),
      ),
    );
  }
}
