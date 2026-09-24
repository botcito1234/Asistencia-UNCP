import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config.dart';
import '../core/errors.dart';
import '../core/theme.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';
import 'privacidad_screen.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formulario = GlobalKey<FormState>();
  final _dni = TextEditingController();
  final _password = TextEditingController();
  bool _ocultarPassword = true;
  bool _enviando = false;
  String? _error;
  String? _codigoError;

  @override
  void initState() {
    super.initState();
    _recuperarUltimoDni();
  }

  Future<void> _recuperarUltimoDni() async {
    // Recordar el DNI ahorra teclear cada dia. La contrasena nunca se guarda.
    final ultimo = await ref.read(authServiceProvider).ultimoDni();
    if (ultimo != null && mounted) {
      setState(() => _dni.text = ultimo);
    }
  }

  @override
  void dispose() {
    _dni.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (!_formulario.currentState!.validate()) return;

    FocusScope.of(context).unfocus();
    setState(() {
      _enviando = true;
      _error = null;
      _codigoError = null;
    });

    try {
      await ref
          .read(sesionProvider.notifier)
          .iniciarSesion(_dni.text.trim(), _password.text);
      // El enrutador de la aplicacion se encarga de la navegacion.
    } on AppException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _codigoError = e.code;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'No se pudo iniciar sesión. Intenta nuevamente.';
        _codigoError = 'ERROR_INTERNO';
      });
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sinConexion = ref.watch(hayConexionProvider).valueOrNull == false;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            if (sinConexion) const BarraSinConexion(),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
                child: Form(
                  key: _formulario,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // --- Identidad visual -----------------------------
                      Center(
                        child: Image.asset(
                          'assets/marca/uncp-escudo.png',
                          height: 92,
                          // El escudo se escala entero: el manual no admite
                          // recortes ni deformaciones.
                          fit: BoxFit.contain,
                          semanticLabel:
                              'Escudo de la Universidad Nacional del Centro del Perú',
                        ),
                      ),
                      const SizedBox(height: 18),
                      const Text(
                        AppConfig.appName,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Universidad Nacional del Centro del Perú',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: ColoresEstado.marca,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Ingresa con tu DNI para registrar tu asistencia',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14, color: Color(0xFF64748B)),
                      ),
                      const SizedBox(height: 32),

                      // --- Credenciales ---------------------------------
                      TextFormField(
                        controller: _dni,
                        keyboardType: TextInputType.number,
                        textInputAction: TextInputAction.next,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(12),
                        ],
                        autofillHints: const [AutofillHints.username],
                        decoration: const InputDecoration(
                          labelText: 'DNI',
                          hintText: '12345678',
                          prefixIcon: Icon(Icons.badge_outlined),
                        ),
                        validator: (v) {
                          final valor = v?.trim() ?? '';
                          if (valor.isEmpty) return 'Escribe tu DNI.';
                          if (valor.length < 8) {
                            return 'El DNI debe tener al menos 8 digitos.';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      TextFormField(
                        controller: _password,
                        obscureText: _ocultarPassword,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _entrar(),
                        decoration: InputDecoration(
                          labelText: 'Contraseña',
                          prefixIcon: const Icon(Icons.lock_outline_rounded),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _ocultarPassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            tooltip: _ocultarPassword
                                ? 'Mostrar contraseña'
                                : 'Ocultar contraseña',
                            onPressed: () => setState(
                                () => _ocultarPassword = !_ocultarPassword),
                          ),
                        ),
                        validator: (v) => (v == null || v.isEmpty)
                            ? 'Escribe tu contraseña.'
                            : null,
                      ),

                      // --- Error ----------------------------------------
                      if (_error != null) ...[
                        const SizedBox(height: 20),
                        Aviso(
                          mensaje: _error!,
                          tono: TonoAviso.peligro,
                          accion: _codigoError == 'DISPOSITIVO_NO_AUTORIZADO'
                              ? const Text(
                                  'Tu cuenta está vinculada a otro teléfono. El administrador debe autorizar el cambio antes de que puedas entrar desde este.',
                                  style: TextStyle(
                                      fontSize: 13, color: Color(0xFF475569)),
                                )
                              : null,
                        ),
                      ],

                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: _enviando ? null : _entrar,
                        child: _enviando
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Ingresar'),
                      ),

                      const SizedBox(height: 28),
                      const Divider(),
                      const SizedBox(height: 16),

                      // --- Transparencia sobre el uso de datos -----------
                      const _NotaPrivacidad(),

                      const SizedBox(height: 12),
                      TextButton.icon(
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const PrivacidadScreen(),
                          ),
                        ),
                        icon: const Icon(Icons.privacy_tip_outlined, size: 18),
                        label: const Text('Leer la política de privacidad'),
                      ),

                      const SizedBox(height: 8),
                      const _CreditoNexora(),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotaPrivacidad extends StatelessWidget {
  const _NotaPrivacidad();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.shield_outlined, size: 16, color: Color(0xFF64748B)),
              SizedBox(width: 6),
              Text(
                'Qué usa esta aplicación',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF475569),
                ),
              ),
            ],
          ),
          SizedBox(height: 8),
          _Punto('Tu ubicación, solo en el momento de marcar.'),
          _Punto('Una fotografía, tomada con la cámara al marcar.'),
          _Punto('Tu cuenta queda vinculada a este teléfono.'),
        ],
      ),
    );
  }
}

/// Credito del estudio que construyo el sistema. Va una sola vez, al pie y a
/// tamano de nota: la pantalla es de la universidad.
class _CreditoNexora extends StatelessWidget {
  const _CreditoNexora();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Text(
          'Desarrollado por',
          style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
        ),
        const SizedBox(width: 6),
        Image.asset('assets/marca/nexora-isotipo.png', height: 16),
        const SizedBox(width: 4),
        const Text(
          'Nexora',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: Color(0xFF64748B),
          ),
        ),
      ],
    );
  }
}

class _Punto extends StatelessWidget {
  const _Punto(this.texto);
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('• ', style: TextStyle(color: Color(0xFF94A3B8))),
          Expanded(
            child: Text(
              texto,
              style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
            ),
          ),
        ],
      ),
    );
  }
}
