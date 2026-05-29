import 'package:click/widgets/label/label_default.dart';
import 'package:flutter/material.dart';

class CellMoradorApto extends StatelessWidget {
  final item;

  const CellMoradorApto({
    Key? key,
    required this.item, 
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: MediaQuery.of(context).size.width,
      // height: 190,
      child: Card(
        elevation: 0,
        child: Container(
          padding: EdgeInsets.fromLTRB(0, 10, 0, 10),
          child: 
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: Colors.grey[200],
                  backgroundImage: ((item['foto_pessoa'] ?? item['photo']) != null && (item['foto_pessoa'] ?? item['photo']).toString().isNotEmpty)
                      ? NetworkImage((item['foto_pessoa'] ?? item['photo']).toString())
                      : null,
                  child: ((item['foto_pessoa'] ?? item['photo']) == null || (item['foto_pessoa'] ?? item['photo']).toString().isEmpty)
                      ? const Icon(Icons.person, color: Colors.grey)
                      : null,
                ),
                const SizedBox(width: 15),
                LabelDefault(title: item['nome'] ?? 'Sem Nome', size: 14),
              ],
            )
        )         
      ),
    );
  }
}
