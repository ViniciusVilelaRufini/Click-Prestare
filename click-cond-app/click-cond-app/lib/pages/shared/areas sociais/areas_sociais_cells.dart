import 'package:click/pages/shared/areas%20sociais/area_social_detail.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/cells/cell_area_social.dart';
import 'package:click/widgets/label/label_default.dart';
import 'package:flutter/material.dart';

class AreasSociaisCells extends StatelessWidget {
  const AreasSociaisCells({
    super.key,
    required this.list,
    required this.reload
  });

  final List<dynamic> list;
  final Function() reload;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
        SizedBox(height: 15),
        if(list.isEmpty)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                LabelDefault(title: getText('alert_list_empty_generic')),
              ],
            ),
        for(var item in list) 
          GestureDetector(
              onTap: (){
                Navigator.push(context,MaterialPageRoute(builder: (context) => AreaSocialDetail(myId: item['id'])),).then((_) {
                    reload();
                  })
                ;},
              child: CellAreaSocial(item: item, hasArrow: true),
            )
        ]
      ),
    );
  }
}

