import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

/// Cambio de contrasena.
///
/// Con [obligatorio] en true es la primera pantalla tras el acceso inicial y no
/// se puede esquivar: la contrasena temporal la conoce el administrador que la
/// entrego, asi que debe dejar de ser valida cuanto antes.
class CambiarPasswordScreen extends ConsumerStatefulWidget {
  const CambiarPasswordScreen({super.key, this.obligatorio = false});

  final bool obligatorio;

  @override
  ConsumerState<CambiarPasswordScreen> createState() =>
      _CambiarPasswordScreenState();
}

class _CambiarPasswordScreenState extends ConsumerState<CambiarPasswordScreen> {
  final _formulario = GlobalKey<FormState>();
  final _actual = TextEditingController();
  final _nueva = TextEditingController();
  final _repetir = TextEditingController();
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _actual.dispose();
    _nueva.dispose();
    _repetir.dispose();
    super.dispose();
  }

  /// Misma politica que aplica el servidor, comprobada aqui para dar respuesta
  /// inmediata. La decision final sigue siendo del servidor.
  String? _validarNueva(String? valor) {
    final v = valor ?? '';
    if (v.length < 8) return 'Debe tener al menos 8 caracteres.';
    if (!RegExp(r'[a-z]').hasMatch(v)) return 'Debe incluir una letra minuscula.';
    if (!RegExp(r'[A-Z]').hasMatch(v)) return 'Debe incluir una letra mayuscula.';
    if (!RegExp(r'[0-9]').hasMatch(v)) return 'Debe incluir un número.';

    final dni = ref.read(usuarioProvider)?.dni;
    if (dni != null && dni.length >= 6 && v.contains(dni)) {
      return 'No puede contener tu DNI.';
    }
    if (v == _actual.text) return 'Debe ser distinta de la actual.';
    return null;
  }

  Future<void> _guardar() async {
    if (!_formulario.currentState!.validate()) return;

    FocusScope.of(context).unfocus();
    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      await ref
          .read(authServiceProvider)
          .cambiarPassword(_actual.text, _nueva.text);

      if (!mounted) return;
      // El servidor cierra todas las sesiones al cambiar la contrasena; hay que
      // volver a entrar con la nueva.
      ref.read(sesionProvider.notifier).forzarCierre();
      mostrarAviso(
        context,
        'Contraseña actualizada. Ingresa nuevamente con tu nueva contraseña.',
        tono: TonoAviso.exito,
      );
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final contenido = Scaffold(
      appBar: AppBar(
        title: Text(widget.obligatorio
            ? 'Cambia tu contraseña'
            : 'Cambiar contraseña'),
        automaticallyImplyLeading: !widget.obligatorio,
        actions: widget.obligatorio
            ? [
                TextButton(
                  onPressed: () =>
                      ref.read(sesionProvider.notifier).cerrarSesion(),
                  child: const Text('Salir',
                      style: TextStyle(color: Colors.white)),
                ),
              ]
            : null,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Form(
            key: _formulario,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.obligatorio) ...[
                  const Aviso(
                    titulo: 'Primer ingreso',
                    mensaje:
                        'Por seguridad debes reemplazar la contraseña temporal que te entregó el administrador antes de usar la aplicación.',
                    tono: TonoAviso.aviso,
                  ),
                  const SizedBox(height: 20),
                ],

                TextFormField(
                  controller: _actual,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Contraseña actual',
                    prefixIcon: Icon(Icons.lock_outline_rounded),
                  ),
                  validator: (v) => (v == null || v.isEmpty)
                      ? 'Escribe tu contraseña actual.'
                      : null,
                ),
                const SizedBox(height: 16),

                TextFormField(
                  controller: _nueva,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Nueva contraseña',
                    prefixIcon: Icon(Icons.lock_reset_rounded),
                  ),
                  validator: _validarNueva,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 10),
                _RequisitosPassword(valor: _nueva.text),
                const SizedBox(height: 16),

                TextFormField(
                  controller: _repetir,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Repite la nueva contraseña',
                    prefixIcon: Icon(Icons.check_circle_outline_rounded),
                  ),
                  validator: (v) =>
                      v != _nueva.text ? 'Las contraseñas no coinciden.' : null,
                ),

                if (_error != null) ...[
                  const SizedBox(height: 20),
                  Aviso(mensaje: _error!, tono: TonoAviso.peligro),
                ],

                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _enviando ? null : _guardar,
                  child: _enviando
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.5, color: Colors.white),
                        )
                      : const Text('Guardar contraseña'),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Al cambiarla se cerrarán todas tus sesiones y tendrás que ingresar de nuevo.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    return widget.obligatorio
        ? PopScope(canPop: false, child: contenido)
        : contenido;
  }
}

class _RequisitosPassword extends StatelessWidget {
  const _RequisitosPassword({required this.valor});
  final String valor;

  @override
  Widget build(BuildContext context) {
    final requisitos = <String, bool>{
      'Al menos 8 caracteres': valor.length >= 8,
      'Una letra minúscula': RegExp(r'[a-z]').hasMatch(valor),
      'Una letra mayúscula': RegExp(r'[A-Z]').hasMatch(valor),
      'Un número': RegExp(r'[0-9]').hasMatch(valor),
    };

    return Wrap(
      spacing: 12,
      runSpacing: 4,
      children: requisitos.entries.map((r) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              r.value ? Icons.check_circle_rounded : Icons.circle_outlined,
              size: 14,
              color: r.value ? const Color(0xFF059669) : const Color(0xFFCBD5E1),
            ),
            const SizedBox(width: 4),
            Text(
              r.key,
              style: TextStyle(
                fontSize: 12,
                color: r.value
                    ? const Color(0xFF059669)
                    : const Color(0xFF94A3B8),
              ),
            ),
          ],
        );
      }).toList(),
    );
  }
}
