# 🚀 Guia de Publicação - Click Condomínios

Este documento contém os passos finais que você (humano) precisa realizar para publicar o App na Play Store, pois envolvem senhas e arquivos privados.

## 1. Gerar a Chave de Assinatura (Keystore)
O Google exige que o App seja assinado. No seu terminal, rode:
```bash
keytool -genkey -v -keystore c:/Users/vinic/Desktop/Click-with-Prestare/click-cond-app/click-cond-app/android/app/upload-keystore.jks -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```
*Guarde a senha que você criar!*

## 2. Configurar Credenciais
No arquivo `android/local.properties`, adicione estas linhas com os dados que você criou:
```properties
storeFile=upload-keystore.jks
storePassword=SUA_SENHA_AQUI
keyAlias=upload
keyPassword=SUA_SENHA_AQUI
```

## 3. Ativar Assinatura de Produção
No arquivo `android/app/build.gradle`, altere a linha 59 de:
`signingConfig signingConfigs.debug`
para:
`signingConfig signingConfigs.release`

## 4. Gerar o arquivo para o Google (AAB)
No terminal, dentro da pasta `click-cond-app/click-cond-app`, rode:
```bash
flutter build appbundle
```
O arquivo será gerado em: `build/app/outputs/bundle/release/app-release.aab`.

## 5. Requisitos de Identidade (Visual)
* **Ícones**: Já verifiquei que existem, mas certifique-se de que o logo em `assets/icon/icon.png` é o definitivo.
* **Splash Screen**: Recomendo usar o pacote `flutter_native_splash` para criar uma tela de abertura profissional.

## 6. Play Console (Burocracia)
1. Acesse [Google Play Console](https://play.google.com/console).
2. Crie sua conta de desenvolvedor ($25).
3. Faça upload do `.aab` gerado no passo 4.
4. **Política de Privacidade**: Você precisará de uma URL. Pode usar geradores gratuitos online e hospedar no GitHub Pages ou em um domínio próprio.

---
**Status atual**: 
- [x] API configurada para Produção (Railway).
- [x] Permissões de Android revisadas.
- [x] Estrutura de build preparada para chaves.
- [ ] Geração da Keystore (Ação necessária sua).
- [ ] Upload para a loja (Ação necessária sua).
