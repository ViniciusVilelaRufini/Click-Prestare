# Guia Rápido: Como Executar o Emulador Android e o App

Este guia prático explica como iniciar o emulador de Android configurado (`Pixel 10`) e rodar o aplicativo de forma rápida pelo terminal do Windows.

---

## 🚀 Passo 1: Iniciar o Emulador

Você pode iniciar o emulador diretamente usando o Flutter no terminal (PowerShell ou CMD):

```powershell
C:\Users\vinic\Desktop\flutter\bin\flutter.bat emulators --launch Pixel_10
```

> [!TIP]
> Caso queira abrir o emulador sem precisar do Flutter, você também pode usar o executável do próprio Android SDK:
> ```powershell
> C:\Users\vinic\AppData\Local\Android\Sdk\emulator\emulator.exe -avd Pixel_10
> ```

Aguarde cerca de **10 a 15 segundos** até o emulador carregar completamente a tela inicial.

---

## 📱 Passo 2: Executar o Aplicativo

Com o emulador aberto, navegue até a pasta do aplicativo Flutter (`click-cond-app/click-cond-app`) e execute o comando:

```powershell
C:\Users\vinic\Desktop\flutter\bin\flutter.bat run -d emulator-5554
```

> [!NOTE]
> Se o emulador for o único dispositivo Android conectado, você pode rodar simplesmente:
> ```powershell
> C:\Users\vinic\Desktop\flutter\bin\flutter.bat run
> ```

---

## 🛠️ Solução de Problemas Comuns

### 1. O comando trava em "Installing..." ou não detecta o emulador
Isso geralmente acontece por conflitos com múltiplos processos do ADB (Android Debug Bridge) abertos em segundo plano. Para resolver:

1. **Feche todos os processos do ADB travados:**
   ```powershell
   taskkill /F /IM adb.exe
   ```
2. **Verifique se o emulador voltou a ser detectado:**
   ```powershell
   C:\Users\vinic\AppData\Local\Android\Sdk\platform-tools\adb.exe devices
   ```
   *(Deve aparecer `emulator-5554 device` na lista)*.
3. **Execute o `flutter run` novamente.**

### 2. O emulador está lento ou fechando o app sozinho
Nós aumentamos os limites de memória do emulador para **4GB de RAM** e **512MB de heap de VM** no arquivo `config.ini` do AVD, garantindo estabilidade. Se ainda assim notar lentidão:
- Certifique-se de fechar outros programas pesados no computador.
- Se o alerta de compatibilidade de 16 KB reaparecer, clique em **"Don't Show Again"** para que a simulação continue rodando no modo compatível sem interrupções.
