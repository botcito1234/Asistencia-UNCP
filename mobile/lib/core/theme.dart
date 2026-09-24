/// Tema visual de la aplicacion.
///
/// Los colores de estado (puntual, tardanza, falta, critico) se definen una sola
/// vez aqui y se usan igual en toda la aplicacion y en el panel web, para que
/// una tardanza se vea siempre del mismo color.
library;

import 'package:flutter/material.dart';

class ColoresEstado {
  const ColoresEstado._();

  // Paleta de marca (manual de Nexora, ver .frontend-design/BRAND.md).
  // #0B1F3A manda en barras y titulos; #2563EB es el color de accion; #38BDF8
  // el acento. Los colores de estado de mas abajo NO son de marca: son
  // informacion, y por eso no cambian.
  static const marca = Color(0xFF0B1F3A);
  static const marcaClara = Color(0xFF2563EB);
  static const marcaAcento = Color(0xFF38BDF8);

  static const exito = Color(0xFF059669);
  static const exitoSuave = Color(0xFFECFDF5);

  static const aviso = Color(0xFFB45309);
  static const avisoSuave = Color(0xFFFFFBEB);

  static const peligro = Color(0xFFB91C1C);
  static const peligroSuave = Color(0xFFFEF2F2);

  static const info = Color(0xFF0369A1);
  static const infoSuave = Color(0xFFF0F9FF);

  static const neutro = Color(0xFF475569);
  static const neutroSuave = Color(0xFFF1F5F9);

  /// Color asociado al estado de una jornada.
  static Color deEstado(String estado, {String? puntualidad}) {
    if (estado == 'AUSENTE') return peligro;
    if (estado == 'PRESENTE') {
      return puntualidad == 'TARDANZA' ? aviso : exito;
    }
    return neutro;
  }

  static Color deSeveridad(String severidad) {
    switch (severidad) {
      case 'CRITICO':
        return peligro;
      case 'ADVERTENCIA':
        return aviso;
      default:
        return info;
    }
  }
}

ThemeData construirTema() {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: 'Sora',
    colorScheme: ColorScheme.fromSeed(
      seedColor: ColoresEstado.marcaClara,
      primary: ColoresEstado.marcaClara,
      brightness: Brightness.light,
    ),
  );

  return base.copyWith(
    scaffoldBackgroundColor: const Color(0xFFF8FAFC),

    appBarTheme: const AppBarTheme(
      backgroundColor: ColoresEstado.marca,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: Colors.white,
        fontSize: 18,
        fontWeight: FontWeight.w600,
      ),
    ),

    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      margin: EdgeInsets.zero,
    ),

    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: ColoresEstado.marcaClara,
        foregroundColor: Colors.white,
        // Altura generosa: la aplicacion se usa de pie, a veces con prisa y
        // con una sola mano.
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        foregroundColor: ColoresEstado.marca,
        side: const BorderSide(color: Color(0xFFCBD5E1)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),

    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: ColoresEstado.marcaClara,
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: ColoresEstado.marcaClara, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: ColoresEstado.peligro),
      ),
    ),

    dividerTheme: const DividerThemeData(color: Color(0xFFE2E8F0), space: 1),

    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),

    chipTheme: base.chipTheme.copyWith(
      side: BorderSide.none,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
  );
}
