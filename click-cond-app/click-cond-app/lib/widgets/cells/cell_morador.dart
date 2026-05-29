import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/label/label_default.dart';
import 'package:flutter/material.dart';

class CellMorador extends StatelessWidget {
  final bool? hasArrow;
  final item;

  const CellMorador({
    Key? key,
    required this.item, 
    this.hasArrow,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: MediaQuery.of(context).size.width,
      // height: 190,
      child: Card(
        child: Container(
          padding: EdgeInsets.fromLTRB(0, 20, 10, 20),
          child: 
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(4.0),
                  child: Container(
                    height: 100,
                    width: 5,
                    color: Theme.of(context).primaryColor,
                  ),
                ),
                SizedBox(width: 10),
                CircleAvatar(                      
                  radius: 45,
                  backgroundColor: Colors.grey[200],
                  backgroundImage: ((item['foto_pessoa'] ?? item['photo']) != null && (item['foto_pessoa'] ?? item['photo']).toString().isNotEmpty)
                      ? NetworkImage((item['foto_pessoa'] ?? item['photo']).toString())
                      : null,
                  child: ((item['foto_pessoa'] ?? item['photo']) == null || (item['foto_pessoa'] ?? item['photo']).toString().isEmpty)
                      ? const Icon(Icons.person, color: Colors.grey, size: 30)
                      : null,
                ),
                SizedBox(width: 10),
                SizedBox(
                  height: 100, 
                  width: MediaQuery.of(context).size.width - 170,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Flexible(fit: FlexFit.loose, child: LabelDefault(title: item['nome'], color: Theme.of(context).hintColor, size: 20, weight: FontWeight.w600, maxLines: 1,)),
                      SizedBox(height: 10),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.start,
                        children: [
                          Icon(Icons.house_outlined, size: 23, color: Theme.of(context).hintColor,),
                          SizedBox(width: 5),
                          LabelDefault(title: '${getText('lb_bloco')} ${item[getText('lb_bloco')]} - ${getText('lb_apto')} ${item[getText('lb_apartamento')]}', size: 18),
                        ],
                      ),
                      SizedBox(height: 10),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: <Widget>[
                          LabelDefault(title: item["tipo"], color: Theme.of(context).hintColor, size: 18, weight: FontWeight.w600),
                        ],
                      ),
                    ],
                  ),
                )
              ],
            ),
        )
      ),
    );
  }
}
