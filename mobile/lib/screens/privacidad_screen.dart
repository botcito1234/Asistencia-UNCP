import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

/// Politica de privacidad.
///
/// Se descarga del servidor, no viene dentro del APK: asi puede actualizarse
/// sin publicar una version nueva de la aplicacion, y la version que se muestra
/// es siempre la misma que la que el practicante acepta.
class PrivacidadScreen extends ConsumerWidget {
  const PrivacidadScreen({super.key, this.mostrarAceptar = false, this.onAceptar});

  final bool mostrarAceptar;
  final Future<void> Function(String version)? onAceptar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final politica = ref.watch(politicaProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Política de privacidad')),
      body: politica.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => VistaError(
          error: e,
          onReintentar: () => ref.invalidate(politicaProvider),
        ),
        data: (datos) => _Contenido(
          datos: datos,
          mostrarAceptar: mostrarAceptar,
          onAceptar: onAceptar,
        ),
      ),
    );
  }
}

final politicaProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (ref) async => ref.watch(authServiceProvider).politicaPrivacidad(),
);

class _Contenido extends StatelessWidget {
  const _Contenido({
    required this.datos,
    required this.mostrarAceptar,
    this.onAceptar,
  });

  final Map<String, dynamic> datos;
  final bool mostrarAceptar;
  final Future<void> Function(String version)? onAceptar;

  @override
  Widget build(BuildContext context) {
    final secciones = (datos['secciones'] as List<dynamic>? ?? []);
    final version = datos['version'] as String? ?? '1.0';

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          datos['titulo'] as String? ?? 'Política de privacidad',
          style: const TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w700,
            color: Color(0xFF0F172A),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Versión $version  ·  ${datos['actualizada'] ?? ''}',
          style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
        ),
        const SizedBox(height: 16),

        if (datos['resumen'] != null)
          Aviso(mensaje: datos['resumen'] as String, tono: TonoAviso.info),

        const SizedBox(height: 16),

        for (final seccion in secciones) ...[
          _Seccion(seccion as Map<String, dynamic>),
          const SizedBox(height: 12),
        ],

        if (datos['consentimiento'] != null) ...[
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: ColoresEstado.infoSuave,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFBAE6FD)),
            ),
            child: Text(
              datos['consentimiento'] as String,
              style: const TextStyle(
                fontSize: 14,
                height: 1.5,
                color: Color(0xFF0C4A6E),
              ),
            ),
          ),
        ],

        if (mostrarAceptar && onAceptar != null) ...[
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () => onAceptar!(version),
            child: const Text('Acepto y continuar'),
          ),
        ],

        const SizedBox(height: 32),
      ],
    );
  }
}

class _Seccion extends StatelessWidget {
  const _Seccion(this.seccion);
  final Map<String, dynamic> seccion;

  @override
  Widget build(BuildContext context) {
    final puntos = (seccion['contenido'] as List<dynamic>? ?? []).cast<String>();

    return TarjetaSeccion(
      titulo: seccion['titulo'] as String?,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final punto in puntos)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 6, right: 8),
                    child: Icon(Icons.circle, size: 5, color: Color(0xFF94A3B8)),
                  ),
                  Expanded(
                    child: Text(
                      punto,
                      style: const TextStyle(
                        fontSize: 14,
                        height: 1.5,
                        color: Color(0xFF475569),
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
