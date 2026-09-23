# Evidência — Fluxos app/API

- Flutter: `flutter test` passou com **176 testes**.
- API de visitantes: **14 suítes / 85 testes** passaram nos dois modos de
  migração.
- Emulador `emulator-5554`: tela de visitantes, filtros vazios, solicitações
  pendentes e formulário de novo visitante foram carregados sem erro.
- Não foi criado visitante real no banco: as tabelas estavam vazias e o
  cadastro exigiria dados pessoais; os testes CRUD são cobertos por fixtures
  automatizadas.
- APK release construído com sucesso em `build/app/outputs/flutter-apk/app-release.apk`.

Resultado: **PASS** para testes automatizados e smoke test; CRUD completo
interativo com registro sintético permanece pendente para um ambiente de
homologação dedicado.
