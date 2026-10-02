import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors.dart';
import '../core/theme.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

class InicioConductorScreen extends ConsumerStatefulWidget {
  const InicioConductorScreen({super.key});

  @override
  ConsumerState<InicioConductorScreen> createState() =>
      _InicioConductorScreenState();
}

class _InicioConductorScreenState extends ConsumerState<InicioConductorScreen> {
  late Future<List<Map<String, dynamic>>> _practicantes;

  @override
  void initState() {
    super.initState();
    _practicantes = ref.read(teacherServiceProvider).misPracticantes();
  }

  Future<void> _crearReporte(Map<String, dynamic> intern) async {
    final detail = TextEditingController();
    final recommendation = TextEditingController();
    var nature = 'OBSERVACION_DE_MEJORA';
    var importance = 'MEDIO';
    var category = 'OTROS';
    String? validationError;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(
            'Seguimiento: ${intern['lastNames']}, ${intern['firstNames']}',
          ),
          content: SingleChildScrollView(
            child: Column(
              children: [
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: 'Categoría'),
                  initialValue: category,
                  items: const [
                    DropdownMenuItem(value: 'OTROS', child: Text('Otros')),
                    DropdownMenuItem(
                      value: 'DOMINIO_DISCIPLINAR',
                      child: Text('Dominio disciplinar'),
                    ),
                    DropdownMenuItem(
                      value: 'PLANIFICACION',
                      child: Text('Planificación'),
                    ),
                    DropdownMenuItem(
                      value: 'MANEJO_DE_AULA',
                      child: Text('Manejo de aula'),
                    ),
                    DropdownMenuItem(
                      value: 'METODOLOGIA',
                      child: Text('Metodología'),
                    ),
                    DropdownMenuItem(
                      value: 'PUNTUALIDAD',
                      child: Text('Puntualidad'),
                    ),
                    DropdownMenuItem(
                      value: 'RESPONSABILIDAD',
                      child: Text('Responsabilidad'),
                    ),
                    DropdownMenuItem(
                      value: 'COMUNICACION',
                      child: Text('Comunicación'),
                    ),
                  ],
                  onChanged: (v) => setLocal(() => category = v ?? category),
                ),
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: 'Naturaleza'),
                  initialValue: nature,
                  items: const [
                    DropdownMenuItem(
                      value: 'POSITIVA',
                      child: Text('Positiva'),
                    ),
                    DropdownMenuItem(
                      value: 'OBSERVACION_DE_MEJORA',
                      child: Text('Observación de mejora'),
                    ),
                    DropdownMenuItem(
                      value: 'INCIDENCIA',
                      child: Text('Incidencia'),
                    ),
                  ],
                  onChanged: (v) => setLocal(() => nature = v ?? nature),
                ),
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(labelText: 'Importancia'),
                  initialValue: importance,
                  items: const [
                    DropdownMenuItem(value: 'BAJO', child: Text('Bajo')),
                    DropdownMenuItem(value: 'MEDIO', child: Text('Medio')),
                    DropdownMenuItem(value: 'ALTO', child: Text('Alto')),
                  ],
                  onChanged: (v) =>
                      setLocal(() => importance = v ?? importance),
                ),
                TextField(
                  controller: detail,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Detalle *'),
                ),
                TextField(
                  controller: recommendation,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Recomendación'),
                ),
                if (validationError != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    validationError!,
                    style: const TextStyle(
                      color: ColoresEstado.peligro,
                      fontSize: 13,
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () {
                if (detail.text.trim().length < 10) {
                  setLocal(
                    () => validationError =
                        'Escribe al menos 10 caracteres en el detalle.',
                  );
                  return;
                }
                Navigator.pop(context, true);
              },
              child: const Text('Guardar'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await ref
          .read(teacherServiceProvider)
          .crearReporte(
            internId: intern['id'] as String,
            category: category,
            nature: nature,
            importance: importance,
            detail: detail.text,
            recommendation: recommendation.text,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reporte enviado a administración.')),
        );
      }
    } catch (error) {
      if (mounted) {
        mostrarAviso(
          context,
          error is AppException
              ? error.message
              : 'No se pudo enviar el reporte. Intenta nuevamente.',
          tono: TonoAviso.peligro,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            MarcaNexora(sobreOscuro: true, compacta: true),
            SizedBox(width: 10),
            Text('Docente conductor'),
          ],
        ),
        actions: [
          IconButton(
            onPressed: () => ref.read(sesionProvider.notifier).cerrarSesion(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: _practicantes,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return VistaError(
              error: snapshot.error!,
              onReintentar: () => setState(
                () => _practicantes = ref
                    .read(teacherServiceProvider)
                    .misPracticantes(),
              ),
            );
          }
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final items = snapshot.data!;
          if (items.isEmpty) {
            return const EstadoVacio(
              icono: Icons.people_outline_rounded,
              titulo: 'No tienes practicantes asignados',
              descripcion:
                  'Cuando administración te asigne practicantes, aparecerán aquí para registrar seguimiento.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => setState(
              () => _practicantes = ref
                  .read(teacherServiceProvider)
                  .misPracticantes(),
            ),
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              itemBuilder: (context, index) {
                final intern = items[index];
                return Card(
                  child: ListTile(
                    leading: const CircleAvatar(
                      child: Icon(Icons.person_outline),
                    ),
                    title: Text(
                      '${intern['lastNames']}, ${intern['firstNames']}',
                    ),
                    subtitle: Text(
                      intern['site']?['name'] as String? ?? 'Sede no indicada',
                    ),
                    trailing: IconButton(
                      icon: const Icon(
                        Icons.note_add_outlined,
                        color: ColoresEstado.marca,
                      ),
                      onPressed: () => _crearReporte(intern),
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
