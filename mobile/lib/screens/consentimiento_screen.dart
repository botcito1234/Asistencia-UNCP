import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';
import 'privacidad_screen.dart';

/// Consentimiento informado.
///
/// Es una barrera real: sin aceptar no se llega a la pantalla de marcacion,
/// porque no se puede tratar ubicacion ni fotografia sin base legal. La
/// aceptacion queda registrada en el servidor con fecha y version.
class ConsentimientoScreen extends ConsumerStatefulWidget {
  const ConsentimientoScreen({super.key});

  @override
  ConsumerState<ConsentimientoScreen> createState() =>
      _ConsentimientoScreenState();
}

class _ConsentimientoScreenState extends ConsumerState<ConsentimientoScreen> {
  bool _enviando = false;

  Future<void> _aceptar(String version) async {
    setState(() => _enviando = true);
    try {
      await ref.read(authServiceProvider).aceptarConsentimiento(version);
      await ref.read(sesionProvider.notifier).refrescarUsuario();
    } on AppException catch (e) {
      if (mounted) mostrarAviso(context, e.message, tono: TonoAviso.peligro);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_enviando) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return PopScope(
      // No se puede esquivar con el boton atras: es una condicion previa.
      canPop: false,
      child: PrivacidadScreen(
        mostrarAceptar: true,
        onAceptar: _aceptar,
      ),
    );
  }
}
