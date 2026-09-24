import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Formato de fechas en espanol para todas las pantallas.
  await initializeDateFormatting('es_PE', null);

  // La aplicacion se usa de pie y con una mano: se fija la orientacion
  // vertical para que la camara y los botones no se reacomoden a mitad del
  // flujo de marcacion.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const ProviderScope(child: AsistenciaApp()));
}
