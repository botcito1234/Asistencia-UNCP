import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';
import 'cambiar_password_screen.dart';
import 'historial_screen.dart';
import 'marcacion_flujo_screen.dart';
import 'notificaciones_screen.dart';
import 'privacidad_screen.dart';

/// Pantalla principal del practicante.
///
/// Muestra de un vistazo: quien es, donde debe estar, a que hora, como va su
/// dia y que puede hacer ahora mismo. El servidor es quien decide si se puede
/// marcar; la aplicacion solo presenta esa decision y su motivo.
class InicioPracticanteScreen extends ConsumerWidget {
  const InicioPracticanteScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final usuario = ref.watch(usuarioProvider);
    final estado = ref.watch(estadoHoyProvider);
    final sinConexion = ref.watch(hayConexionProvider).valueOrNull == false;
    final notificaciones = ref.watch(notificacionesProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        // El escudo va a color sobre una pastilla blanca: la version
        // monocromatica es de contorno fino y a este tamano se emborrona
        // sobre el azul marino de la barra.
        leading: Padding(
          padding: const EdgeInsets.only(left: 12, top: 9, bottom: 9),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Image.asset(
              'assets/marca/uncp-escudo.png',
              semanticLabel: 'Universidad Nacional del Centro del Perú',
            ),
          ),
        ),
        leadingWidth: 62,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              usuario?.practicante?.nombres ?? 'Mi asistencia',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            if (usuario?.practicante != null)
              Text(
                usuario!.practicante!.sede.nombre,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                  color: Color(0xFFCBD5E1),
                ),
              ),
          ],
        ),
        actions: [
          _BotonNotificaciones(sinLeer: notificaciones?.sinLeer ?? 0),
          _MenuUsuario(),
        ],
      ),
      body: Column(
        children: [
          if (sinConexion) const BarraSinConexion(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(estadoHoyProvider);
                ref.invalidate(hayConexionProvider);
                ref.invalidate(notificacionesProvider);
                await ref.read(estadoHoyProvider.future);
              },
              child: estado.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => ListView(
                  children: [
                    SizedBox(
                      height: MediaQuery.of(context).size.height * 0.6,
                      child: VistaError(
                        error: e,
                        onReintentar: () => ref.invalidate(estadoHoyProvider),
                      ),
                    ),
                  ],
                ),
                data: (hoy) => _Contenido(hoy: hoy),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Contenido extends ConsumerWidget {
  const _Contenido({required this.hoy});
  final EstadoHoy hoy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fecha = DateFormat("EEEE d 'de' MMMM", 'es_PE')
        .format(DateTime.parse('${hoy.fechaNegocio}T12:00:00Z'));

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // --- Encabezado del dia -------------------------------------------
        Text(
          _capitalizar(fecha),
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: Color(0xFF0F172A),
          ),
        ),
        const SizedBox(height: 2),
        Row(
          children: [
            const Icon(Icons.schedule_rounded,
                size: 14, color: Color(0xFF94A3B8)),
            const SizedBox(width: 4),
            Text(
              'Hora del servidor: ${hoy.horaLocal}',
              style: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // --- Estado del dia ------------------------------------------------
        _TarjetaEstadoDia(hoy: hoy),
        const SizedBox(height: 12),

        // --- Acciones -------------------------------------------------------
        _Acciones(hoy: hoy),
        const SizedBox(height: 12),

        // --- Horario --------------------------------------------------------
        TarjetaSeccion(
          titulo: 'Tu jornada de hoy',
          child: Column(
            children: [
              FilaDato(
                etiqueta: 'Hora de entrada programada',
                valor: hoy.horaEntradaProgramada ?? 'Sin jornada',
                destacado: true,
              ),
              if (hoy.horaSalidaProgramada != null)
                FilaDato(
                  etiqueta: 'Hora de salida referencial',
                  valor: hoy.horaSalidaProgramada!,
                ),
              if (hoy.abreA != null)
                FilaDato(
                  etiqueta: 'Puedes marcar desde',
                  valor: hoy.abreA!,
                ),
              FilaDato(etiqueta: 'Sede', valor: hoy.sede.nombre),
              FilaDato(
                etiqueta: 'Radio permitido',
                valor: '${hoy.sede.radioMetros} m',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // --- Requisitos -----------------------------------------------------
        TarjetaSeccion(
          titulo: 'Para que tu marcación sea válida',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Requisito(
                icono: Icons.wifi_rounded,
                texto: 'Tener conexión a Internet',
              ),
              _Requisito(
                icono: Icons.location_on_outlined,
                texto:
                    'Estar dentro de tu sede (máximo ${hoy.sede.radioMetros} m)',
              ),
              _Requisito(
                icono: Icons.gps_fixed_rounded,
                texto:
                    'GPS con precisión de ${hoy.precisionMaximaMetros.round()} m o mejor',
              ),
              _Requisito(
                icono: Icons.photo_camera_outlined,
                texto: 'Tomar una fotografía con la cámara',
              ),
              _Requisito(
                icono: Icons.smartphone_rounded,
                texto: 'Usar este teléfono, el vinculado a tu cuenta',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // --- Historial ------------------------------------------------------
        OutlinedButton.icon(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const HistorialScreen()),
          ),
          icon: const Icon(Icons.history_rounded),
          label: const Text('Ver mi historial'),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  String _capitalizar(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

class _TarjetaEstadoDia extends StatelessWidget {
  const _TarjetaEstadoDia({required this.hoy});
  final EstadoHoy hoy;

  @override
  Widget build(BuildContext context) {
    final color =
        ColoresEstado.deEstado(hoy.estado, puntualidad: hoy.puntualidad);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Estado de hoy',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF1E293B),
                    ),
                  ),
                ),
                Etiqueta.estado(hoy.estado, puntualidad: hoy.puntualidad),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: _Marca(
                    etiqueta: 'Entrada',
                    hora: hoy.entrada?.horaLocal,
                    detalle: hoy.entrada == null
                        ? null
                        : '${hoy.entrada!.distanciaMetros.round()} m de la sede',
                    color: hoy.puntualidad == 'TARDANZA'
                        ? ColoresEstado.aviso
                        : ColoresEstado.exito,
                  ),
                ),
                Container(
                  width: 1,
                  height: 52,
                  color: const Color(0xFFE2E8F0),
                ),
                Expanded(
                  child: _Marca(
                    etiqueta: 'Salida',
                    hora: hoy.salida?.horaLocal,
                    detalle: hoy.salida == null
                        ? (hoy.salidaPendiente ? 'Pendiente' : null)
                        : '${hoy.salida!.distanciaMetros.round()} m de la sede',
                    color: hoy.salidaPendiente
                        ? ColoresEstado.aviso
                        : ColoresEstado.exito,
                  ),
                ),
              ],
            ),
            if (hoy.puntualidad == 'TARDANZA' && hoy.minutosTardanza > 0) ...[
              const SizedBox(height: 14),
              Aviso(
                mensaje:
                    'Tu entrada se registró con ${hoy.minutosTardanza} minuto(s) de tardanza.',
                tono: TonoAviso.aviso,
              ),
            ],
            if (hoy.salidaPendiente && hoy.salida == null) ...[
              const SizedBox(height: 14),
              const Aviso(
                mensaje:
                    'Registraste tu entrada pero aún no tu salida. Recuerda marcarla antes de retirarte.',
                tono: TonoAviso.aviso,
              ),
            ],
            const SizedBox(height: 4),
            // Refuerza visualmente el color del estado sin depender solo de el.
            Container(height: 3, color: color),
          ],
        ),
      ),
    );
  }
}

class _Marca extends StatelessWidget {
  const _Marca({
    required this.etiqueta,
    required this.hora,
    required this.color,
    this.detalle,
  });

  final String etiqueta;
  final String? hora;
  final String? detalle;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          etiqueta.toUpperCase(),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
            color: Color(0xFF64748B),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          hora ?? '--:--',
          style: TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w700,
            color: hora == null ? const Color(0xFFCBD5E1) : color,
            height: 1.1,
          ),
        ),
        if (detalle != null)
          Text(
            detalle!,
            style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
          ),
      ],
    );
  }
}

class _Acciones extends ConsumerWidget {
  const _Acciones({required this.hoy});
  final EstadoHoy hoy;

  Future<void> _marcar(BuildContext context, WidgetRef ref, bool entrada) async {
    final resultado = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => MarcacionFlujoScreen(esEntrada: entrada, estado: hoy),
      ),
    );

    if (resultado == true) {
      ref.invalidate(estadoHoyProvider);
      ref.invalidate(notificacionesProvider);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!hoy.tieneHorario) {
      return const Aviso(
        titulo: 'Sin jornada programada',
        mensaje:
            'Hoy no tienes horario asignado, por lo que no corresponde marcar asistencia.',
        tono: TonoAviso.info,
      );
    }

    if (hoy.puedeMarcarEntrada) {
      return Column(
        children: [
          if (hoy.motivo != null) ...[
            Aviso(mensaje: hoy.motivo!, tono: TonoAviso.aviso),
            const SizedBox(height: 12),
          ],
          FilledButton.icon(
            onPressed: () => _marcar(context, ref, true),
            icon: const Icon(Icons.login_rounded, size: 22),
            label: const Text('Marcar entrada'),
          ),
        ],
      );
    }

    if (hoy.puedeMarcarSalida) {
      return FilledButton.icon(
        onPressed: () => _marcar(context, ref, false),
        style: FilledButton.styleFrom(backgroundColor: ColoresEstado.exito),
        icon: const Icon(Icons.logout_rounded, size: 22),
        label: const Text('Marcar salida'),
      );
    }

    // No puede marcar: se explica por que y, si aplica, desde cuando podra.
    return Aviso(
      titulo: hoy.abreA != null && hoy.entrada == null
          ? 'Aún no puedes marcar'
          : 'Jornada completa',
      mensaje: hoy.motivo ?? 'No hay acciones disponibles en este momento.',
      tono: hoy.entrada != null && hoy.salida != null
          ? TonoAviso.exito
          : TonoAviso.info,
    );
  }
}

class _Requisito extends StatelessWidget {
  const _Requisito({required this.icono, required this.texto});
  final IconData icono;
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Icon(icono, size: 18, color: const Color(0xFF64748B)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              texto,
              style: const TextStyle(fontSize: 14, color: Color(0xFF475569)),
            ),
          ),
        ],
      ),
    );
  }
}

class _BotonNotificaciones extends StatelessWidget {
  const _BotonNotificaciones({required this.sinLeer});
  final int sinLeer;

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        IconButton(
          tooltip: 'Notificaciones',
          icon: const Icon(Icons.notifications_outlined),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const NotificacionesScreen(),
            ),
          ),
        ),
        if (sinLeer > 0)
          Positioned(
            top: 8,
            right: 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
              decoration: BoxDecoration(
                color: ColoresEstado.peligro,
                borderRadius: BorderRadius.circular(999),
              ),
              constraints: const BoxConstraints(minWidth: 16),
              child: Text(
                sinLeer > 9 ? '9+' : '$sinLeer',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _MenuUsuario extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert_rounded),
      tooltip: 'Más opciones',
      onSelected: (opcion) async {
        switch (opcion) {
          case 'password':
            await Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const CambiarPasswordScreen(),
              ),
            );
          case 'privacidad':
            if (context.mounted) {
              await Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const PrivacidadScreen(),
                ),
              );
            }
          case 'salir':
            await ref.read(sesionProvider.notifier).cerrarSesion();
        }
      },
      itemBuilder: (_) => const [
        PopupMenuItem(
          value: 'password',
          child: ListTile(
            leading: Icon(Icons.lock_reset_rounded),
            title: Text('Cambiar contraseña'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuItem(
          value: 'privacidad',
          child: ListTile(
            leading: Icon(Icons.privacy_tip_outlined),
            title: Text('Privacidad'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuDivider(),
        PopupMenuItem(
          value: 'salir',
          child: ListTile(
            leading: Icon(Icons.logout_rounded, color: ColoresEstado.peligro),
            title: Text('Cerrar sesión',
                style: TextStyle(color: ColoresEstado.peligro)),
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ],
    );
  }
}
