import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../core/errors.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

const Map<String, String> etiquetaEvento = {
  'FUERA_DE_GEOCERCA': 'Fuera del radio de la sede',
  'UBICACION_SIMULADA': 'Ubicación simulada',
  'GPS_IMPRECISO': 'GPS impreciso',
  'DISPOSITIVO_NO_AUTORIZADO': 'Dispositivo no autorizado',
  'SESION_SIMULTANEA': 'Sesión simultánea',
  'ENTRADA_DUPLICADA': 'Entrada duplicada',
  'SALIDA_DUPLICADA': 'Salida duplicada',
  'SALIDA_SIN_ENTRADA': 'Salida sin entrada',
  'MARCACION_FUERA_DE_VENTANA': 'Fuera de la ventana horaria',
  'CREDENCIALES_INVALIDAS': 'Credenciales inválidas',
  'CUENTA_BLOQUEADA': 'Cuenta bloqueada',
  'EVIDENCIA_INVALIDA': 'Evidencia inválida',
  'INTENTO_SOSPECHOSO': 'Intento sospechoso',
  'SALIDA_PENDIENTE': 'Salida pendiente',
  'FALTA_REGISTRADA': 'Falta registrada',
  'ARCHIVADO_FALLIDO': 'Fallo de archivado',
};

/// Alertas de seguridad para el administrador.
///
/// Son intentos RECHAZADOS e incidentes: ninguno de estos registros cuenta como
/// asistencia.
class AlertasAdminScreen extends ConsumerStatefulWidget {
  const AlertasAdminScreen({super.key, this.embebido = false});

  final bool embebido;

  @override
  ConsumerState<AlertasAdminScreen> createState() => _AlertasAdminScreenState();
}

class _AlertasAdminScreenState extends ConsumerState<AlertasAdminScreen> {
  int _diasAtras = 7;

  RangoFechas get _rango {
    final f = DateFormat('yyyy-MM-dd');
    final hoy = DateTime.now();
    return RangoFechas(
      f.format(hoy.subtract(Duration(days: _diasAtras))),
      f.format(hoy),
    );
  }

  Future<void> _atender(EventoSeguridad evento) async {
    final nota = await showDialog<String>(
      context: context,
      builder: (_) => _DialogoAtender(evento: evento),
    );
    if (nota == null) return;

    try {
      await ref.read(adminServiceProvider).atenderAlerta(evento.id, nota);
      ref.invalidate(alertasProvider(_rango));
      if (mounted) {
        mostrarAviso(context, 'Alerta marcada como atendida.',
            tono: TonoAviso.exito);
      }
    } on AppException catch (e) {
      if (mounted) mostrarAviso(context, e.message, tono: TonoAviso.peligro);
    }
  }

  @override
  Widget build(BuildContext context) {
    final alertas = ref.watch(alertasProvider(_rango));

    final cuerpo = alertas.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => VistaError(
        error: e,
        onReintentar: () => ref.invalidate(alertasProvider(_rango)),
      ),
      data: (items) {
        if (items.isEmpty) {
          return const EstadoVacio(
            titulo: 'Sin alertas pendientes',
            descripcion: 'No hay incidentes sin atender en el periodo.',
            icono: Icons.verified_user_outlined,
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(alertasProvider(_rango));
            await ref.read(alertasProvider(_rango).future);
          },
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) => _FilaAlerta(
              evento: items[i],
              onAtender: () => _atender(items[i]),
            ),
          ),
        );
      },
    );

    final selector = Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: SegmentedButton<int>(
        segments: const [
          ButtonSegment(value: 1, label: Text('Hoy')),
          ButtonSegment(value: 7, label: Text('7 días')),
          ButtonSegment(value: 30, label: Text('30 días')),
        ],
        selected: {_diasAtras},
        onSelectionChanged: (s) => setState(() => _diasAtras = s.first),
      ),
    );

    if (widget.embebido) {
      return Column(children: [selector, Expanded(child: cuerpo)]);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Alertas')),
      body: Column(children: [selector, Expanded(child: cuerpo)]),
    );
  }
}

class _FilaAlerta extends StatelessWidget {
  const _FilaAlerta({required this.evento, required this.onAtender});

  final EventoSeguridad evento;
  final VoidCallback onAtender;

  @override
  Widget build(BuildContext context) {
    final color = ColoresEstado.deSeveridad(evento.severidad);
    final momento = DateFormat("d MMM, HH:mm", 'es_PE')
        .format(DateTime.parse(evento.creadoEn).toLocal());

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    etiquetaEvento[evento.tipo] ?? evento.tipo,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ),
                Etiqueta(
                  texto: evento.severidad == 'CRITICO'
                      ? 'Crítico'
                      : evento.severidad == 'ADVERTENCIA'
                          ? 'Aviso'
                          : 'Info',
                  color: color,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              evento.mensaje,
              style: const TextStyle(
                fontSize: 13,
                height: 1.4,
                color: Color(0xFF475569),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 2,
              children: [
                if (evento.practicante != null)
                  _Meta(icono: Icons.person_outline, texto: evento.practicante!),
                if (evento.sede != null)
                  _Meta(icono: Icons.business_outlined, texto: evento.sede!),
                _Meta(icono: Icons.schedule_rounded, texto: momento),
              ],
            ),
            if (!evento.atendido) ...[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: onAtender,
                  icon: const Icon(Icons.done_rounded, size: 18),
                  label: const Text('Marcar como atendida'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icono, required this.texto});
  final IconData icono;
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icono, size: 13, color: const Color(0xFF94A3B8)),
        const SizedBox(width: 3),
        Text(
          texto,
          style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
        ),
      ],
    );
  }
}

class _DialogoAtender extends StatefulWidget {
  const _DialogoAtender({required this.evento});
  final EventoSeguridad evento;

  @override
  State<_DialogoAtender> createState() => _DialogoAtenderState();
}

class _DialogoAtenderState extends State<_DialogoAtender> {
  final _nota = TextEditingController();

  @override
  void dispose() {
    _nota.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Atender alerta'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.evento.mensaje,
            style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _nota,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Nota (opcional)',
              hintText: 'Qué se verificó o qué medida se tomó',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_nota.text),
          child: const Text('Marcar atendida'),
        ),
      ],
    );
  }
}
