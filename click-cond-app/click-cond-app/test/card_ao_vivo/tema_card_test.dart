import 'package:click/services/firebase_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('tema do app vai ao servidor no formato do card ao vivo', () {
    expect(FirebaseService.temaDoApp(ThemeMode.light), 'claro');
    expect(FirebaseService.temaDoApp(ThemeMode.dark), 'escuro');
    expect(FirebaseService.temaDoApp(ThemeMode.system), 'sistema');
  });
}
