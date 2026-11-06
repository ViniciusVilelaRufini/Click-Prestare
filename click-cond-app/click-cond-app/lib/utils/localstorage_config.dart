import 'dart:ui' as ui;
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/log.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:localstorage/localstorage.dart';

class LocalStorageConfig {
  static final LocalStorageConfig _singleton = LocalStorageConfig._internal();
  LocalStorageConfig._internal();
  static LocalStorageConfig get instance => _singleton;

  final _configStorage = LocalStorage('user_config');

  /// Aguarda ambos os storages estarem prontos antes de usar qualquer dado
  Future<void> initializeLocalStorage() async {
    await Future.wait([
      // Preferências ilegíveis não impedem a sessão de carregar.
      _configStorage.ready.catchError((Object e) {
        logDebug('[LocalStorage] user_config ilegível: ${e.runtimeType}');
        return false;
      }),
      ensureStorageReady(), // aguarda o storage de user_data (local_storage.dart)
    ]);
  }

  savePreferenceLanguage(String language) {
    _configStorage.setItem('languageCode', language);
    Singleton.instance.mainView?.update();
  }

  String getPreferenceLanguage() {
    final code = _configStorage.getItem('languageCode');
    if (code != null && code.toString().isNotEmpty) {
      return code.toString();
    }
    try {
      final localeName = kIsWeb ? 'pt_BR' : ui.window.locale.toString();
      if (localeName.contains('pt_BR')) return 'pt_BR';
      if (localeName.contains('en')) return 'en_US';
      if (localeName.contains('pt')) return 'pt_PT';
      if (localeName.contains('de')) return 'de';
      return 'pt_BR';
    } catch (e) {
      return 'pt_BR';
    }
  }

  savePreferenceBrightness(String? brightness) {
    _configStorage.setItem('brightness', brightness);
  }

  bool getPreferenceIsLightMode() {
    final saved = _configStorage.getItem('brightness');
    if (saved != null) return saved == "light";
    final brightness = SchedulerBinding.instance.platformDispatcher.platformBrightness;
    return brightness != Brightness.dark;
  }

  String? getPreferenceBrightnessToBottomSheet() {
    return _configStorage.getItem('brightness');
  }

  savePreferenceHomeView(String preference) {
    _configStorage.setItem('homeView', preference);
  }

  bool getPreferenceHomeViewIsList() {
    final saved = _configStorage.getItem('homeView');
    return saved == null ? true : saved == "list";
  }
}
