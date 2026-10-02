import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config.dart';
import 'core/theme.dart';
import 'screens/cambiar_password_screen.dart';
import 'screens/consentimiento_screen.dart';
import 'screens/inicio_admin_screen.dart';
import 'screens/inicio_practicante_screen.dart';
import 'screens/inicio_conductor_screen.dart';
import 'screens/login_screen.dart';
import 'state/providers.dart';
import 'widgets/comunes.dart';

/// Raiz de la aplicacion.
///
/// La navegacion principal no usa rutas con nombre sino un arbol de decision
/// sobre el estado de la sesion: es mas dificil dejar accesible una pantalla
/// que requiere condiciones previas (contrasena cambiada, consentimiento
/// aceptado) si esas condiciones se evaluan en un solo sitio.
class AsistenciaApp extends ConsumerWidget {
  const AsistenciaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: construirTema(),
      locale: const Locale('es', 'PE'),
      supportedLocales: const [Locale('es', 'PE'), Locale('es')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const _Enrutador(),
    );
  }
}

class _Enrutador extends ConsumerWidget {
  const _Enrutador();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sesion = ref.watch(sesionProvider);

    final reduceMovimiento = MediaQuery.of(context).disableAnimations;
    Widget transicionar(String clave, Widget child) {
      return AnimatedSwitcher(
        duration: reduceMovimiento
            ? Duration.zero
            : const Duration(milliseconds: 280),
        reverseDuration: reduceMovimiento
            ? Duration.zero
            : const Duration(milliseconds: 180),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        transitionBuilder: (vista, animation) {
          final escala = Tween<double>(begin: 0.985, end: 1).animate(
            CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
          );
          return FadeTransition(
            opacity: animation,
            child: ScaleTransition(scale: escala, child: vista),
          );
        },
        child: KeyedSubtree(key: ValueKey(clave), child: child),
      );
    }

    if (sesion.fase == FaseSesion.cargando) {
      return transicionar('cargando', const _PantallaCarga());
    }

    final usuario = sesion.usuario;
    if (usuario == null) return transicionar('login', const LoginScreen());

    // 1. Contrasena inicial: es lo primero, antes que cualquier otra cosa.
    if (usuario.debeCambiarPassword) {
      return transicionar(
        'cambiar-password',
        const CambiarPasswordScreen(obligatorio: true),
      );
    }

    // 2. Consentimiento informado: sin el no se puede tratar ubicacion ni foto.
    final practicante = usuario.practicante;
    if (usuario.esPracticante &&
        practicante != null &&
        !practicante.consentimientoAceptado) {
      return transicionar('consentimiento', const ConsentimientoScreen());
    }

    // 3. Interfaz segun el rol.
    if (usuario.esAdministrador) {
      return transicionar('administrador', const InicioAdminScreen());
    }
    if (usuario.esDocenteConductor) {
      return transicionar('conductor', const InicioConductorScreen());
    }
    return transicionar('practicante', const InicioPracticanteScreen());
  }
}

class _PantallaCarga extends StatelessWidget {
  const _PantallaCarga();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: ColoresEstado.marca,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const MarcaNexora(sobreOscuro: true),
            const SizedBox(height: 24),
            const Text(
              AppConfig.productName,
              style: TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 32),
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                color: Colors.white,
                strokeWidth: 2.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
