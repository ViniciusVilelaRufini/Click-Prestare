import 'package:click/pages/perfil_choice.dart';
import 'package:click/pages/shared/delivery/list_delivery.dart';
import 'package:flutter/material.dart';

class RouterGenerator {
  static Route<dynamic> generateRouter(RouteSettings settings) {
    switch (settings.name) {
      case '/':
        return MaterialPageRoute(
          settings: RouteSettings(name: "/"),
          builder: (_) => HomePage(),
        );
      case '/delivery':
        return MaterialPageRoute(
          settings: const RouteSettings(name: '/delivery'),
          builder: (_) => const ListDelivery(),
        );
      default:
        return MaterialPageRoute(
          settings: RouteSettings(name: "/"),
          builder: (_) => HomePage(),
        );
    }
  }
}
