import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

/// Historial de asistencia del practicante.
class HistorialScreen extends ConsumerStatefulWidget {
  const HistorialScreen({super.key});

  @override
  ConsumerState<HistorialScreen> createState() => _HistorialScreenState();
}

class _HistorialScreenState extends ConsumerState<HistorialScreen> {
  int _diasAtras = 30;

  RangoFechas get _rango {
    final hoy = DateTime.now();
    final desde = hoy.subtract(Duration(days: _diasAtras));
    final f = DateFormat('yyyy-MM-dd');
    return RangoFechas(f.format(desde), f.format(hoy));
  }

  @override
  Widget build(BuildContext context) {
    final historial = ref.watch(historialProvider(_rango));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mi historial'),
        actions: [
          PopupMenuButton<int>(
            icon: const Icon(Icons.calendar_month_rounded),
            tooltip: 'Periodo',
            onSelected: (dias) => setState(() => _diasAtras = dias),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 7, child: Text('Últimos 7 días')),
              PopupMenuItem(value: 30, child: Text('Últimos 30 días')),
              PopupMenuItem(value: 90, child: Text('Últimos 3 meses')),
              PopupMenuItem(value: 180, child: Text('Últimos 6 meses')),
            ],
          ),
        ],
      ),
      body: historial.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => VistaError(
          error: e,
          onReintentar: () => ref.invalidate(historialProvider(_rango)),
        ),
        data: (datos) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(historialProvider(_rango));
            await ref.read(historialProvider(_rango).future);
          },
          child: _Contenido(
            jornadas: datos.jornadas,
            resumen: datos.resumen,
            diasAtras: _diasAtras,
          ),
        ),
      ),
    );
  }
}

class _Contenido extends StatelessWidget {
  const _Contenido({
    required this.jornadas,
    required this.resumen,
    required this.diasAtras,
  });

  final List<Jornada> jornadas;
  final ResumenPeriodo resumen;
  final int diasAtras;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Resumen de los últimos $diasAtras días',
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: Color(0xFF1E293B),
          ),
        ),
        const SizedBox(height: 12),

        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 2.0,
          children: [
            Indicador(
              etiqueta: 'Jornadas',
              valor: '${resumen.jornadasProgramadas}',
            ),
            Indicador(
              etiqueta: 'Puntuales',
              valor: '${resumen.puntuales}',
              color: ColoresEstado.exito,
            ),
            Indicador(
              etiqueta: 'Tardanzas',
              valor: '${resumen.tardanzas}',
              color: ColoresEstado.aviso,
              detalle: resumen.minutosTardanzaTotal > 0
                  ? '${resumen.minutosTardanzaTotal} min acumulados'
                  : null,
            ),
            Indicador(
              etiqueta: 'Faltas',
              valor: '${resumen.ausentes}',
              color: ColoresEstado.peligro,
            ),
          ],
        ),

        if (resumen.porcentajePuntualidad != null) ...[
          const SizedBox(height: 12),
          _BarraPuntualidad(porcentaje: resumen.porcentajePuntualidad!),
        ],

        if (resumen.salidasPendientes > 0) ...[
          const SizedBox(height: 12),
          Aviso(
            mensaje:
                'Tienes ${resumen.salidasPendientes} jornada(s) sin registro de salida.',
            tono: TonoAviso.aviso,
          ),
        ],

        const SizedBox(height: 20),
        const Text(
          'Detalle por día',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: Color(0xFF1E293B),
          ),
        ),
        const SizedBox(height: 10),

        if (jornadas.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 40),
            child: EstadoVacio(
              titulo: 'Sin registros',
              descripcion: 'No hay jornadas en el periodo seleccionado.',
              icono: Icons.event_busy_rounded,
            ),
          )
        else
          ...jornadas.map((j) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _FilaJornada(jornada: j),
              )),

        const SizedBox(height: 24),
      ],
    );
  }
}

class _BarraPuntualidad extends StatelessWidget {
  const _BarraPuntualidad({required this.porcentaje});
  final double porcentaje;

  @override
  Widget build(BuildContext context) {
    final color = porcentaje >= 90
        ? ColoresEstado.exito
        : porcentaje >= 70
            ? ColoresEstado.aviso
            : ColoresEstado.peligro;

    return TarjetaSeccion(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Puntualidad del periodo',
                  style: TextStyle(fontSize: 14, color: Color(0xFF475569)),
                ),
              ),
              Text(
                '${porcentaje.toStringAsFixed(1)} %',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: (porcentaje / 100).clamp(0.0, 1.0),
              minHeight: 8,
              backgroundColor: const Color(0xFFE2E8F0),
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
        ],
      ),
    );
  }
}

class _FilaJornada extends StatelessWidget {
  const _FilaJornada({required this.jornada});
  final Jornada jornada;

  @override
  Widget build(BuildContext context) {
    final fecha = DateTime.parse('${jornada.fecha}T12:00:00Z');
    final dia = DateFormat('EEE d MMM', 'es_PE').format(fecha);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            Row(
              children: [
                SizedBox(
                  width: 82,
                  child: Text(
                    _capitalizar(dia),
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF334155),
                    ),
                  ),
                ),
                Expanded(
                  child: Row(
                    children: [
                      _Hora(
                        etiqueta: 'Entrada',
                        valor: jornada.horaEntrada,
                        programada: jornada.horaProgramada,
                      ),
                      const SizedBox(width: 14),
                      _Hora(
                        etiqueta: 'Salida',
                        valor: jornada.horaSalida,
                        pendiente: jornada.salidaPendiente,
                      ),
                    ],
                  ),
                ),
                Etiqueta.estado(jornada.estado,
                    puntualidad: jornada.puntualidad),
              ],
            ),
            if (jornada.minutosTardanza > 0 || jornada.regularizada) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  if (jornada.minutosTardanza > 0)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Text(
                        '${jornada.minutosTardanza} min de tardanza',
                        style: const TextStyle(
                          fontSize: 12,
                          color: ColoresEstado.aviso,
                        ),
                      ),
                    ),
                  if (jornada.regularizada)
                    const Etiqueta(
                      texto: 'Regularizada',
                      color: ColoresEstado.info,
                      icono: Icons.edit_note_rounded,
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _capitalizar(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

class _Hora extends StatelessWidget {
  const _Hora({
    required this.etiqueta,
    required this.valor,
    this.programada,
    this.pendiente = false,
  });

  final String etiqueta;
  final String? valor;
  final String? programada;
  final bool pendiente;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          etiqueta,
          style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8)),
        ),
        Text(
          valor ?? (pendiente ? 'Pendiente' : '--:--'),
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: valor != null
                ? const Color(0xFF1E293B)
                : pendiente
                    ? ColoresEstado.aviso
                    : const Color(0xFFCBD5E1),
          ),
        ),
      ],
    );
  }
}
