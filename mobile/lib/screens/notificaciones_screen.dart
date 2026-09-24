import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

/// Notificaciones recibidas.
///
/// El canal interno funciona siempre. Las notificaciones push del sistema
/// requieren credenciales de Firebase en el servidor; sin ellas, los avisos
/// siguen llegando aqui.
class NotificacionesScreen extends ConsumerWidget {
  const NotificacionesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificaciones = ref.watch(notificacionesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notificaciones'),
        actions: [
          if ((notificaciones.valueOrNull?.sinLeer ?? 0) > 0)
            TextButton(
              onPressed: () async {
                await ref.read(notificationServiceProvider).marcarTodasLeidas();
                ref.invalidate(notificacionesProvider);
              },
              child: const Text(
                'Marcar leídas',
                style: TextStyle(color: Colors.white),
              ),
            ),
        ],
      ),
      body: notificaciones.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => VistaError(
          error: e,
          onReintentar: () => ref.invalidate(notificacionesProvider),
        ),
        data: (datos) {
          if (datos.items.isEmpty) {
            return const EstadoVacio(
              titulo: 'Sin notificaciones',
              descripcion: 'Aquí apareceran los avisos sobre tu asistencia.',
              icono: Icons.notifications_off_outlined,
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(notificacionesProvider);
              await ref.read(notificacionesProvider.future);
            },
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: datos.items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _Fila(
                notificacion: datos.items[i],
                onLeer: () async {
                  await ref
                      .read(notificationServiceProvider)
                      .marcarLeida(datos.items[i].id);
                  ref.invalidate(notificacionesProvider);
                },
              ),
            ),
          );
        },
      ),
    );
  }
}

class _Fila extends StatelessWidget {
  const _Fila({required this.notificacion, required this.onLeer});

  final Notificacion notificacion;
  final VoidCallback onLeer;

  @override
  Widget build(BuildContext context) {
    final color = ColoresEstado.deSeveridad(notificacion.severidad);
    final momento = DateFormat("d MMM, HH:mm", 'es_PE')
        .format(DateTime.parse(notificacion.creadaEn).toLocal());

    return Opacity(
      opacity: notificacion.leida ? 0.6 : 1,
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: notificacion.leida ? null : onLeer,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    // ignore: deprecated_member_use
                    color: color.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(_icono(notificacion.tipo), size: 19, color: color),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              notificacion.titulo,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: notificacion.leida
                                    ? FontWeight.w500
                                    : FontWeight.w700,
                                color: const Color(0xFF0F172A),
                              ),
                            ),
                          ),
                          if (!notificacion.leida)
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: ColoresEstado.marcaClara,
                                shape: BoxShape.circle,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        notificacion.cuerpo,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.4,
                          color: Color(0xFF475569),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        momento,
                        style: const TextStyle(
                          fontSize: 11,
                          color: Color(0xFF94A3B8),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  IconData _icono(String tipo) => switch (tipo) {
        'ENTRADA_REGISTRADA' => Icons.login_rounded,
        'SALIDA_REGISTRADA' => Icons.logout_rounded,
        'TARDANZA_REGISTRADA' => Icons.schedule_rounded,
        'FALTA_REGISTRADA' => Icons.event_busy_rounded,
        'SALIDA_PENDIENTE' => Icons.pending_actions_rounded,
        'FUERA_DE_GEOCERCA' => Icons.wrong_location_rounded,
        'UBICACION_SIMULADA' => Icons.gpp_bad_rounded,
        'DISPOSITIVO_NO_AUTORIZADO' => Icons.phonelink_lock_rounded,
        'REGULARIZACION' => Icons.edit_note_rounded,
        'ARCHIVADO' => Icons.archive_rounded,
        _ => Icons.notifications_rounded,
      };
}
