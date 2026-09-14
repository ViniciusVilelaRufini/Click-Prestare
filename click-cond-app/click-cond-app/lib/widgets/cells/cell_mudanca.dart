import 'package:click/utils/log.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/alerts/modal_recusa_mudanca.dart';
import 'package:click/widgets/buttons/status_button.dart';
import 'package:click/widgets/label/label_default.dart';
import 'package:flutter/material.dart';

class CellMudanca extends StatelessWidget {
  final bool? hasArrow;
  final item;
  final Function(int, bool, String) changeStatus;

  const CellMudanca({
    Key? key,
    required this.item, 
    this.hasArrow, 
    required this.changeStatus,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: MediaQuery.of(context).size.width,
      // height: 190,
      child: Card(
        child: Container(
          padding: EdgeInsets.fromLTRB(0, 20, 10, 20),
          child: Row(
            children: [
              Container(
                child: ClipRRect(
                   borderRadius: BorderRadius.circular(4.0),
                   child: Container(
                     height: 100,
                     width: 5,
                     color: item['status'] == 'pendente' ? Colors.yellow
                              : item['status'] == 'recusado' ? Colors.red
                              : Theme.of(context).primaryColor,
                   ),
                ),
              ),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: <Widget>[
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Icon(Icons.house_outlined, size: 20, color: Theme.of(context).hintColor,),
                          SizedBox(width: 5),
                          LabelDefault(title: item["apto"] ?? "", size: 14),
                        ],
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Icon(Icons.watch_later_outlined, size: 20, color: Theme.of(context).hintColor,),
                          SizedBox(width: 5),
                          LabelDefault(title: item['data']+" "+item["hora"], size: 14),
                        ],
                      )
                      
                    ],
                  ),   
                  SizedBox(height: 10),
                  Row(
                    children: <Widget>[
                      LabelDefault(title: "${getText('lb_status')}: ", color: Colors.black, size: 16, weight: FontWeight.w600),
                      SizedBox(width: 5),
                      LabelDefault(title: item['status'], color: Theme.of(context).hintColor, size: 19)
                    ],
                  ),
                  SizedBox(height: 10),
                  if(item["status"] == "recusado")
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        LabelDefault(title: "${getText('mudanca_motivo_recusa')}: ", color: Colors.black, size: 16, weight: FontWeight.w600),
                        SizedBox(height: 5),
                        Row(
                          children: <Widget>[
                            Expanded(child: LabelDefault(title: item['motivo_recusa'] ?? getText('lb_nao_informado'), size: 19, maxLines: 20))
                          ],
                        ),
                        SizedBox(height: 10),
                      ],
                    ),
                  if(getUserType() == 'sindico' || getUserPermission('agendar_mudanca') == 1)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                      StatusButton(title: getText('lb_aceitar'), isRecuse: false, disable: item['status'] == 'aceito',               
                        onPressed: () {
                          changeStatus(item['id'], true, '');
                        }
                      ),
                      SizedBox(width: 40),
                        StatusButton(title: getText('lb_recusar'), isRecuse: true, disable: item['status'] == 'recusado',            
                          onPressed: () async {
                            var res = await showDialog(context: context,
                                builder: (BuildContext context){
                                return ModalRecusaMudanca();
                                }
                              );
                              logDebug(res);
                            if(res != null ){
                              changeStatus(item['id'], false, res);
                            }
                          }
                        )
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        )
      ),
    );
  }
}
