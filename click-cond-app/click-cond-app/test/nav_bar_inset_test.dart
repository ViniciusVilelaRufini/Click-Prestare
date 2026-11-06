import 'package:click/utils/utils.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<double> _folga(WidgetTester tester, double inset) async {
  late double folga;
  await tester.pumpWidget(
    MediaQuery(
      data: MediaQueryData(viewPadding: EdgeInsets.only(bottom: inset)),
      child: Builder(
        builder: (context) {
          folga = navBarBottomPadding(context);
          return const SizedBox();
        },
      ),
    ),
  );
  return folga;
}

void main() {
  testWidgets('iPhone com indicador: reserva reduzida a 14', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(await _folga(tester, 34), 14);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iPhone com botão físico: sem folga', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(await _folga(tester, 0), 0);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('Android mantém o inset inteiro dos botões', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(await _folga(tester, 48), 48);
    debugDefaultTargetPlatformOverride = null;
  });
}
