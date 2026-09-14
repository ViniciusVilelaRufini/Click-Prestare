
import 'dart:ui';

import 'package:click/utils/localizable/localizable_al.dart';
import 'package:click/utils/localizable/localizable_en_us.dart';
import 'package:click/utils/localizable/localizable_es.dart';
import 'package:click/utils/localizable/localizable_pt_br.dart';
import 'package:click/utils/localizable/localizable_pt_pt.dart';
import 'package:click/utils/localstorage_config.dart';
import 'package:flutter/material.dart';

/// Índice chave → texto. Chave duplicada mantém a primeira ocorrência, que é
/// o que o antigo `.where(...).first` fazia.
///
/// Existe também por custo: as listas têm ~450 entradas e eram varridas
/// linearmente a CADA getText — e há tela que chama cinco vezes por build,
/// dentro de lista.
Map<String, String> indiceDe(List<LocalizableModel> strings) {
  final mapa = <String, String>{};
  for (final s in strings) {
    mapa.putIfAbsent(s.key, () => s.text);
  }
  return mapa;
}

/// Resolve em cascata: idioma escolhido → pt_BR → a própria chave.
///
/// O `.first` de antes lançava StateError na chave ausente e o catch devolvia
/// STRING VAZIA: em inglês e alemão, telas inteiras renderizavam títulos e
/// botões em branco, sem erro e sem log. Devolver a chave é feio, mas é
/// visível — alguém vê "lb_meu_apartamento" na tela e conserta.
String resolverTexto(String chave, Map<String, String> idioma, Map<String, String> padrao) {
  final texto = idioma[chave];
  if (texto != null && texto.isNotEmpty) return texto;
  final reserva = padrao[chave];
  if (reserva != null && reserva.isNotEmpty) return reserva;
  return chave;
}

final Map<String, Map<String, String>> _indicesCache = {};

Map<String, String> _indice(String idioma) {
  return _indicesCache.putIfAbsent(idioma, () {
    switch (idioma) {
      case 'en':
        return indiceDe(Localizable_EnUs().strings);
      case 'es':
        return indiceDe(Localizable_Es().strings);
      case 'pt_PT':
        return indiceDe(Localizable_PtPt().strings);
      case 'de':
        return indiceDe(Localizable_Al().strings);
      default:
        return indiceDe(Localizable_PtBr().strings);
    }
  });
}

String getText(String key) {
  try {
    final idioma = LocalStorageConfig.instance.getPreferenceLanguage() ?? 'pt_BR';
    return resolverTexto(key, _indice(idioma), _indice('pt_BR'));
  } catch (e) {
    // Storage indisponível: ainda assim devolve o pt_BR, nunca vazio.
    return resolverTexto(key, const {}, _indice('pt_BR'));
  }
}

Locale getCurrentLocale(){
  try{
    switch (LocalStorageConfig.instance.getPreferenceLanguage()) {
      case 'pt_BR':
        return Locale("pt", "BR");
      case 'en': 
        return Locale("en", "US");
      case 'es': 
        return Locale("es", "ES");
      case 'pt_PT':
        return Locale("pt", "PT");
      case 'de':
        return Locale("de", "DE");
      default:
        return Locale("pt", "BR");
    }
  }catch(e){
    return Locale("pt", "BR");
  }   
}

class LocalizableModel{
  String key;
  String text;

  LocalizableModel({
    required this.key,
    required this.text,
  });
}
