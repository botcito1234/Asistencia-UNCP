import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../core/errors.dart';
import '../core/theme.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

/// Practicantes, desde el movil del administrador.
///
/// Se incluyen aqui las acciones que hay que poder resolver en el momento y
/// desde donde sea: desbloquear a alguien que cambio de telefono y restablecer
/// una contrasena. El alta y la edicion completa viven en el panel web.
class PracticantesAdminScreen extends ConsumerStatefulWidget {
  const PracticantesAdminScreen({super.key, this.embebido = false});

  final bool embebido;

  @override
  ConsumerState<PracticantesAdminScreen> createState() =>
      _PracticantesAdminScreenState();
}

class _PracticantesAdminScreenState
    extends ConsumerState<PracticantesAdminScreen> {
  String _busqueda = '';

  @override
  Widget build(BuildContext context) {
    final practicantes = ref.watch(practicantesProvider(_busqueda));

    final buscador = Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: TextField(
        decoration: const InputDecoration(
          hintText: 'Buscar por DNI, nombre o área',
          prefixIcon: Icon(Icons.search_rounded),
        ),
        onChanged: (v) => setState(() => _busqueda = v),
      ),
    );

    final cuerpo = practicantes.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => VistaError(
        error: e,
        onReintentar: () => ref.invalidate(practicantesProvider(_busqueda)),
      ),
      data: (items) {
        if (items.isEmpty) {
          return const EstadoVacio(
            titulo: 'Sin resultados',
            descripcion: 'Ningún practicante coincide con la busqueda.',
            icono: Icons.person_search_outlined,
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(practicantesProvider(_busqueda));
            await ref.read(practicantesProvider(_busqueda).future);
          },
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) => _FilaPracticante(datos: items[i]),
          ),
        );
      },
    );

    if (widget.embebido) {
      return Column(children: [buscador, Expanded(child: cuerpo)]);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Practicantes')),
      body: Column(children: [buscador, Expanded(child: cuerpo)]),
    );
  }
}

class _FilaPracticante extends ConsumerWidget {
  const _FilaPracticante({required this.datos});
  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activo = datos['active'] as bool? ?? true;
    final tieneDispositivo = datos['hasDevice'] as bool? ?? false;
    final sede = (datos['site'] as Map<String, dynamic>?)?['name'] as String?;
    final ultimoAcceso = datos['lastLoginAt'] as String?;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _abrirAcciones(context, ref),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              CircleAvatar(
                radius: 21,
                // ignore: deprecated_member_use
                backgroundColor: ColoresEstado.marca.withOpacity(0.10),
                child: Text(
                  _iniciales(datos['fullName'] as String? ?? '?'),
                  style: const TextStyle(
                    color: ColoresEstado.marca,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      datos['fullName'] as String? ?? '',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: activo
                            ? const Color(0xFF0F172A)
                            : const Color(0xFF94A3B8),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'DNI ${datos['dni']}${sede != null ? ' · $sede' : ''}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF64748B),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (!activo)
                          const Etiqueta(
                            texto: 'Inactivo',
                            color: ColoresEstado.neutro,
                          ),
                        Etiqueta(
                          texto: tieneDispositivo
                              ? (datos['deviceModel'] as String? ?? 'Vinculado')
                              : 'Sin teléfono',
                          color: tieneDispositivo
                              ? ColoresEstado.exito
                              : ColoresEstado.neutro,
                          icono: Icons.smartphone_rounded,
                        ),
                        if (ultimoAcceso != null)
                          Etiqueta(
                            texto: DateFormat('d MMM', 'es_PE')
                                .format(DateTime.parse(ultimoAcceso).toLocal()),
                            color: ColoresEstado.info,
                            icono: Icons.login_rounded,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: Color(0xFFCBD5E1)),
            ],
          ),
        ),
      ),
    );
  }

  String _iniciales(String nombre) {
    final partes = nombre.replaceAll(',', '').trim().split(RegExp(r'\s+'));
    if (partes.isEmpty) return '?';
    if (partes.length == 1) return partes.first.substring(0, 1).toUpperCase();
    return (partes[0].substring(0, 1) + partes[1].substring(0, 1))
        .toUpperCase();
  }

  void _abrirAcciones(BuildContext context, WidgetRef ref) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _HojaAcciones(datos: datos),
    );
  }
}

class _HojaAcciones extends ConsumerStatefulWidget {
  const _HojaAcciones({required this.datos});
  final Map<String, dynamic> datos;

  @override
  ConsumerState<_HojaAcciones> createState() => _HojaAccionesState();
}

class _HojaAccionesState extends ConsumerState<_HojaAcciones> {
  bool _trabajando = false;

  String get _id => widget.datos['id'] as String;
  String get _nombre => widget.datos['fullName'] as String? ?? '';

  Future<String?> _pedirMotivo(String titulo) {
    final control = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: Text(titulo),
        content: TextField(
          controller: control,
          maxLines: 3,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Motivo (obligatorio)',
            hintText: 'Queda registrado en la auditoria',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(contexto).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () {
              if (control.text.trim().length < 5) return;
              Navigator.of(contexto).pop(control.text.trim());
            },
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
  }

  Future<void> _autorizarCambio() async {
    final motivo = await _pedirMotivo('Autorizar cambio de teléfono');
    if (motivo == null) return;

    setState(() => _trabajando = true);
    try {
      await ref.read(adminServiceProvider).autorizarCambioDispositivo(_id, motivo);
      if (!mounted) return;
      Navigator.of(context).pop();
      mostrarAviso(
        context,
        'Autorizado. $_nombre podrá vincular otro teléfono en su próximo ingreso.',
        tono: TonoAviso.exito,
      );
    } on AppException catch (e) {
      if (mounted) mostrarAviso(context, e.message, tono: TonoAviso.peligro);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Future<void> _restablecerPassword() async {
    final confirmado = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: const Text('Restablecer contraseña'),
        content: Text(
          'Se generará una contraseña temporal para $_nombre y se cerrarán todas sus sesiones.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(contexto).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(contexto).pop(true),
            child: const Text('Restablecer'),
          ),
        ],
      ),
    );
    if (confirmado != true) return;

    setState(() => _trabajando = true);
    try {
      final resultado =
          await ref.read(adminServiceProvider).restablecerPassword(_id);
      if (!mounted) return;
      Navigator.of(context).pop();

      await showDialog<void>(
        context: context,
        builder: (contexto) => AlertDialog(
          title: const Text('Contraseña temporal'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('DNI: ${resultado['dni']}'),
              const SizedBox(height: 8),
              SelectableText(
                resultado['temporaryPassword'] as String? ?? '',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                  fontFamily: 'monospace',
                ),
              ),
              const SizedBox(height: 12),
              const Aviso(
                mensaje:
                    'No se vuelve a mostrar. Entrégala por un canal seguro; deberá cambiarla al ingresar.',
                tono: TonoAviso.aviso,
              ),
            ],
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(contexto).pop(),
              child: const Text('Entendido'),
            ),
          ],
        ),
      );
    } on AppException catch (e) {
      if (mounted) mostrarAviso(context, e.message, tono: TonoAviso.peligro);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sede = (widget.datos['site'] as Map<String, dynamic>?)?['name'];

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _nombre,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'DNI ${widget.datos['dni']}${sede != null ? ' · $sede' : ''}',
              style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 20),

            if (_trabajando)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              OutlinedButton.icon(
                onPressed: _autorizarCambio,
                icon: const Icon(Icons.phonelink_setup_rounded),
                label: const Text('Autorizar cambio de teléfono'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _restablecerPassword,
                icon: const Icon(Icons.lock_reset_rounded),
                label: const Text('Restablecer contraseña'),
              ),
              const SizedBox(height: 16),
              const Text(
                'El alta, la edicion de datos, los horarios y los reportes se gestionan desde el panel web.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
