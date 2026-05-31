import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/label/label_default.dart';
import 'package:flutter/material.dart';

class CellMyAgendamento extends StatelessWidget {
  final item;

  const CellMyAgendamento({
    Key? key,
    required this.item, 
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final String apto = item['apto']?.toString() ?? '';
    final String blocoRaw = item['bloco']?.toString() ?? '';
    String blocoText = '';
    if (blocoRaw.isNotEmpty) {
      final blocoLower = blocoRaw.toLowerCase();
      if (blocoLower.contains('bloco') || 
          blocoLower.contains('bloque') || 
          blocoLower.contains('block')) {
        blocoText = blocoRaw;
      } else {
        blocoText = '${getText('lb_bloco')} $blocoRaw';
      }
    }
    final String aptoBlocoTitle = '${getText('lb_apto')} $apto $blocoText';

    final String status = item['status']?.toString() ?? 'pendente';
    String statusText = getText('lb_pendente');
    Color statusColor = Colors.orange;
    if (status == 'aprovado') {
      statusText = getText('lb_aprovado');
      statusColor = Colors.green;
    } else if (status == 'recusado') {
      statusText = getText('lb_recusado');
      statusColor = Colors.red;
    }

    return Container(
      width: MediaQuery.of(context).size.width,
      child: Card(
        child: Container(
          padding: const EdgeInsets.fromLTRB(0, 20, 10, 20),
          child: Column(
            children: [
              SizedBox(
                width: double.infinity,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 10,
                    runSpacing: 5,
                    children: <Widget>[
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.house_outlined, size: 20, color: Theme.of(context).hintColor),
                          const SizedBox(width: 5),
                          LabelDefault(title: aptoBlocoTitle, size: 14),
                        ],
                      ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.watch_later_outlined, size: 20, color: Theme.of(context).hintColor),
                          const SizedBox(width: 5),
                          LabelDefault(title: item['data_criacao'], size: 14),
                        ],
                      )
                    ],
                  ),
                ),
              ),   
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4.0),
                        child: Container(
                          width: 5,
                          color: statusColor,
                        ),
                      ),
                      const SizedBox(width: 15),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            LabelDefault(title: "${getText('area_social_data_reserva')} "+item['data'], size: 15, maxLines: 2),
                            const SizedBox(height: 5),
                            LabelDefault(title: "${getText('area_social_hora_reserva')} "+item['horaDe']+' - '+item['horaAte'], size: 15, maxLines: 2),                          
                            const SizedBox(height: 10),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.start,
                              children: [
                                LabelDefault(title: "$statusText:", size: 18, color: statusColor, weight: FontWeight.bold),
                                const SizedBox(width: 5),
                                Expanded(
                                  child: LabelDefault(title: item['nomeArea'], size: 18, color: Theme.of(context).primaryColor, weight: FontWeight.bold, maxLines: 1),
                                ),
                              ],
                            ),
                          ],
                        ),
                      )
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
