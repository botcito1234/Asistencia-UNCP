/// Componentes reutilizables de la interfaz movil.
library;

import 'package:flutter/material.dart';

import '../core/errors.dart';
import '../core/theme.dart';

/// Tarjeta con titulo opcional.
class TarjetaSeccion extends StatelessWidget {
  const TarjetaSeccion({
    super.key,
    required this.child,
    this.titulo,
    this.accion,
    this.padding = const EdgeInsets.all(16),
  });

  final Widget child;
  final String? titulo;
  final Widget? accion;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (titulo != null) ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      titulo!,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF1E293B),
                      ),
                    ),
                  ),
                  if (accion != null) accion!,
                ],
              ),
              const SizedBox(height: 12),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

/// Etiqueta de estado con color semantico.
class Etiqueta extends StatelessWidget {
  const Etiqueta({
    super.key,
    required this.texto,
    required this.color,
    this.icono,
  });

  final String texto;
  final Color color;
  final IconData? icono;

  factory Etiqueta.estado(String estado, {String? puntualidad}) {
    final color = ColoresEstado.deEstado(estado, puntualidad: puntualidad);
    final texto = switch (estado) {
      'PRESENTE' => puntualidad == 'TARDANZA' ? 'Tardanza' : 'Presente',
      'AUSENTE' => 'Falta',
      'NO_LABORABLE' => 'Sin jornada',
      _ => 'Programado',
    };
    final icono = switch (estado) {
      'PRESENTE' => puntualidad == 'TARDANZA'
          ? Icons.schedule_rounded
          : Icons.check_circle_rounded,
      'AUSENTE' => Icons.cancel_rounded,
      _ => Icons.remove_circle_outline_rounded,
    };
    return Etiqueta(texto: texto, color: color, icono: icono);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        // ignore: deprecated_member_use
        color: color.withOpacity(0.10),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icono != null) ...[
            Icon(icono, size: 14, color: color),
            const SizedBox(width: 5),
          ],
          Text(
            texto,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Bloque de aviso con tono segun la gravedad.
class Aviso extends StatelessWidget {
  const Aviso({
    super.key,
    required this.mensaje,
    this.titulo,
    this.tono = TonoAviso.info,
    this.accion,
  });

  final String mensaje;
  final String? titulo;
  final TonoAviso tono;
  final Widget? accion;

  @override
  Widget build(BuildContext context) {
    final (color, fondo, icono) = switch (tono) {
      TonoAviso.exito => (
          ColoresEstado.exito,
          ColoresEstado.exitoSuave,
          Icons.check_circle_rounded
        ),
      TonoAviso.aviso => (
          ColoresEstado.aviso,
          ColoresEstado.avisoSuave,
          Icons.warning_amber_rounded
        ),
      TonoAviso.peligro => (
          ColoresEstado.peligro,
          ColoresEstado.peligroSuave,
          Icons.error_rounded
        ),
      TonoAviso.info => (
          ColoresEstado.info,
          ColoresEstado.infoSuave,
          Icons.info_rounded
        ),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: fondo,
        borderRadius: BorderRadius.circular(12),
        // ignore: deprecated_member_use
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icono, color: color, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (titulo != null) ...[
                  Text(
                    titulo!,
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 3),
                ],
                Text(
                  mensaje,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    color: Color(0xFF334155),
                  ),
                ),
                if (accion != null) ...[
                  const SizedBox(height: 10),
                  accion!,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum TonoAviso { info, exito, aviso, peligro }

/// Indicador numerico compacto.
class Indicador extends StatelessWidget {
  const Indicador({
    super.key,
    required this.etiqueta,
    required this.valor,
    this.color = ColoresEstado.neutro,
    this.detalle,
  });

  final String etiqueta;
  final String valor;
  final Color color;
  final String? detalle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            etiqueta.toUpperCase(),
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
              color: Color(0xFF64748B),
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            valor,
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: color,
              height: 1.1,
            ),
          ),
          if (detalle != null)
            Text(
              detalle!,
              style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
    );
  }
}

/// Estado vacio.
class EstadoVacio extends StatelessWidget {
  const EstadoVacio({
    super.key,
    required this.titulo,
    this.descripcion,
    this.icono = Icons.inbox_rounded,
    this.accion,
  });

  final String titulo;
  final String? descripcion;
  final IconData icono;
  final Widget? accion;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icono, size: 48, color: const Color(0xFFCBD5E1)),
            const SizedBox(height: 16),
            Text(
              titulo,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Color(0xFF475569),
              ),
            ),
            if (descripcion != null) ...[
              const SizedBox(height: 6),
              Text(
                descripcion!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14, color: Color(0xFF94A3B8)),
              ),
            ],
            if (accion != null) ...[const SizedBox(height: 20), accion!],
          ],
        ),
      ),
    );
  }
}

/// Vista de error con reintento y, cuando procede, acceso a los ajustes.
class VistaError extends StatelessWidget {
  const VistaError({
    super.key,
    required this.error,
    this.onReintentar,
    this.onAjustes,
  });

  final Object error;
  final VoidCallback? onReintentar;
  final VoidCallback? onAjustes;

  @override
  Widget build(BuildContext context) {
    final esApp = error is AppException;
    final codigo = esApp ? (error as AppException).code : 'ERROR_INTERNO';
    final mensaje = esApp
        ? (error as AppException).message
        : 'Ocurrio un error inesperado.';

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            codigo == 'SIN_CONEXION'
                ? Icons.wifi_off_rounded
                : Icons.error_outline_rounded,
            size: 48,
            color: ColoresEstado.peligro,
          ),
          const SizedBox(height: 16),
          Text(
            mensaje,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: Color(0xFF475569)),
          ),
          const SizedBox(height: 20),
          if (onReintentar != null)
            FilledButton.icon(
              onPressed: onReintentar,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Reintentar'),
            ),
          if (onAjustes != null && ErrorCatalog.abreAjustes(codigo)) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: onAjustes,
              icon: const Icon(Icons.settings_rounded),
              label: const Text('Abrir ajustes'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Barra fija que avisa de la falta de conexion.
class BarraSinConexion extends StatelessWidget {
  const BarraSinConexion({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: ColoresEstado.peligro,
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.wifi_off_rounded, color: Colors.white, size: 16),
          SizedBox(width: 8),
          Flexible(
            child: Text(
              'Sin conexión a Internet. No podrás marcar asistencia.',
              style: TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

/// Fila de dato etiquetado.
class FilaDato extends StatelessWidget {
  const FilaDato({
    super.key,
    required this.etiqueta,
    required this.valor,
    this.destacado = false,
  });

  final String etiqueta;
  final String valor;
  final bool destacado;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              etiqueta,
              style: const TextStyle(fontSize: 14, color: Color(0xFF64748B)),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              valor,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: 14,
                fontWeight: destacado ? FontWeight.w700 : FontWeight.w500,
                color: const Color(0xFF1E293B),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Muestra un aviso emergente coherente en toda la aplicacion.
void mostrarAviso(
  BuildContext context,
  String mensaje, {
  TonoAviso tono = TonoAviso.info,
}) {
  final color = switch (tono) {
    TonoAviso.exito => ColoresEstado.exito,
    TonoAviso.aviso => ColoresEstado.aviso,
    TonoAviso.peligro => ColoresEstado.peligro,
    TonoAviso.info => ColoresEstado.marca,
  };

  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(mensaje),
        backgroundColor: color,
        duration: const Duration(seconds: 4),
      ),
    );
}
