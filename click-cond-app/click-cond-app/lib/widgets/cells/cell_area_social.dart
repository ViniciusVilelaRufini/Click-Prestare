import 'package:click/widgets/label/label_title.dart';
import 'package:flutter/material.dart';

class CellAreaSocial extends StatelessWidget {
  final bool? hasArrow;
  final item;

  const CellAreaSocial({
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
          child: Row(
            children: [
              Container(
                child: ClipRRect(
                   borderRadius: BorderRadius.circular(4.0),
                   child: Container(
                     height: 150,
                     width: 5,
                     color: Theme.of(context).primaryColor,
                   ),
                ),
              ),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: <Widget>[
                    Stack(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8.0),
                          child: Image.network(
                            (item["imagem"] != null && item["imagem"].toString().isNotEmpty)
                                ? item["imagem"]
                                : 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600',
                            width: MediaQuery.of(context).size.width,
                            height: 150,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) => Container(
                              width: MediaQuery.of(context).size.width,
                              height: 150,
                              color: Colors.grey.shade200,
                              child: Icon(Icons.image, size: 50, color: Colors.grey.shade400),
                            ),
                          ),
                        ),
                        if (item["tem_monitoramento"] == true)
                          _OcupacaoBadge(ocupacao: int.tryParse('${item["ocupacao"] ?? 0}') ?? 0),
                      ],
                    ),
                    SizedBox(height: 10),
                    LabelTitle(title: item["nome"], size: 16),
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

/// Selo sobre a imagem da área mostrando quantas pessoas estão dentro agora
/// (contagem derivada dos acessos dos dispositivos vinculados à área).
class _OcupacaoBadge extends StatelessWidget {
  final int ocupacao;
  const _OcupacaoBadge({Key? key, required this.ocupacao}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final vazia = ocupacao <= 0;
    return Positioned(
      top: 8,
      right: 8,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.62),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.people, size: 16, color: Colors.white),
            SizedBox(width: 5),
            Text(
              vazia ? 'Vazio' : '$ocupacao ${ocupacao == 1 ? 'pessoa' : 'pessoas'}',
              style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}
