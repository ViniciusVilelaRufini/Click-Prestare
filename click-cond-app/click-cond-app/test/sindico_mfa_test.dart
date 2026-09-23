import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/mfa_verification_page.dart';
import 'package:click/utils/local_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SindicoLoginResult', () {
    test('instancia corretamente resultado com MFA obrigatório', () {
      const result = SindicoLoginResult(
        mfaRequired: true,
        mfaToken: 'uuid-1234-token',
        emailMasked: 'ca****@prestare.com.br',
        expiresInSeconds: 600,
      );

      expect(result.mfaRequired, isTrue);
      expect(result.success, isFalse);
      expect(result.mfaToken, 'uuid-1234-token');
      expect(result.emailMasked, 'ca****@prestare.com.br');
      expect(result.expiresInSeconds, 600);
      expect(result.errorMessage, isNull);
    });

    test('instancia corretamente resultado de login com sucesso direto', () {
      const result = SindicoLoginResult(success: true);

      expect(result.success, isTrue);
      expect(result.mfaRequired, isFalse);
      expect(result.mfaToken, isNull);
      expect(result.errorMessage, isNull);
    });

    test('instancia corretamente erro de credenciais inválidas', () {
      const result = SindicoLoginResult(
        success: false,
        errorMessage: 'Login ou Senha incorretos',
      );

      expect(result.success, isFalse);
      expect(result.mfaRequired, isFalse);
      expect(result.errorMessage, 'Login ou Senha incorretos');
    });
  });

  group('Dispositivo Confiável (Device Token) no Storage', () {
    test('grava e recupera token do dispositivo do síndico', () {
      setSindicoDeviceToken('mock-trusted-device-token-abc');
      expect(getSindicoDeviceToken(), 'mock-trusted-device-token-abc');
    });

    test('preserva token do aparelho confiável no logout para manter os 30 dias', () async {
      setSindicoDeviceToken('device-token-30-dias');
      expect(getSindicoDeviceToken(), 'device-token-30-dias');

      await storageLogout();

      // Após logout, token de sessão JWT é limpo, mas o token do dispositivo físico é preservado
      expect(getToken(), '');
      expect(getSindicoDeviceToken(), 'device-token-30-dias');
    });
  });

  group('MfaVerificationPage Widget', () {
    testWidgets('mantém confirmar acessível acima do teclado', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(const MaterialApp(
        home: MfaVerificationPage(mfaToken: 'teste', emailMasked: 'si****@click.com', expiresInSeconds: 600),
      ));
      await tester.tap(find.byType(TextField));
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Ocultar teclado'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renderiza tela de verificação 2FA com elementos esperados',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: MfaVerificationPage(
            mfaToken: 'test-mfa-token',
            emailMasked: 'si****@click.com',
            expiresInSeconds: 600,
          ),
        ),
      );

      // Título e e-mail
      expect(find.text('Autenticação em 2 Etapas'), findsOneWidget);
      expect(find.textContaining('si****@click.com'), findsOneWidget);
      expect(find.text('Digite o código recebido'), findsOneWidget);

      // Checkbox de 30 dias
      expect(find.text('Lembrar deste aparelho por 30 dias'), findsOneWidget);

      // Botão de confirmação
      expect(find.text('Confirmar e Entrar'), findsOneWidget);

      // 1 campo de texto unificado OTP (evita fechar teclado no iOS a cada dígito)
      expect(find.byType(TextField), findsOneWidget);

      // Digita o código de 6 dígitos no campo
      await tester.enterText(find.byType(TextField), '123456');
      await tester.pump();

      // Confirma que os dígitos aparecem na tela nas caixas visuais
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
      expect(find.text('5'), findsOneWidget);
      expect(find.text('6'), findsOneWidget);
    });
  });
}
