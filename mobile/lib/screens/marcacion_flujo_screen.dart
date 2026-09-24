import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../core/config.dart';
import '../core/errors.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/camera_service.dart';
import '../services/location_service.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';

/// Flujo completo de marcacion.
///
/// Orden deliberado: primero se valida todo lo que puede fallar sin coste
/// (conexion, permisos, GPS, geocerca) y solo despues se abre la camara. Asi
/// nadie se toma una fotografia para que luego le digan que esta fuera de la
/// sede.
///
/// La comprobacion de geocerca que se hace aqui es orientativa: sirve para
/// avisar antes de gastar tiempo. La decision vinculante la toma el servidor,
/// que recalcula la distancia con las coordenadas recibidas.
enum PasoMarcacion { ubicacion, revisionUbicacion, camara, revisionFoto, enviando, resultado }

class MarcacionFlujoScreen extends ConsumerStatefulWidget {
  const MarcacionFlujoScreen({
    super.key,
    required this.esEntrada,
    required this.estado,
  });

  final bool esEntrada;
  final EstadoHoy estado;

  @override
  ConsumerState<MarcacionFlujoScreen> createState() =>
      _MarcacionFlujoScreenState();
}

class _MarcacionFlujoScreenState extends ConsumerState<MarcacionFlujoScreen> {
  PasoMarcacion _paso = PasoMarcacion.ubicacion;

  LecturaUbicacion? _ubicacion;
  EvidenciaCapturada? _evidencia;
  ResultadoMarcacion? _resultado;

  String _progreso = 'Preparando...';
  AppException? _error;

  CameraController? _camara;
  bool _camaraLista = false;
  bool _capturando = false;

  @override
  void initState() {
    super.initState();
    // El flujo arranca solo: el usuario ya pulso el boton, no hay que pedirle
    // que confirme otra vez.
    WidgetsBinding.instance.addPostFrameCallback((_) => _obtenerUbicacion());
  }

  @override
  void dispose() {
    _camara?.dispose();
    super.dispose();
  }

  String get _titulo => widget.esEntrada ? 'Marcar entrada' : 'Marcar salida';

  // ---------------------------------------------------------------------------
  // Paso 1: ubicacion
  // ---------------------------------------------------------------------------

  Future<void> _obtenerUbicacion() async {
    setState(() {
      _paso = PasoMarcacion.ubicacion;
      _error = null;
      _progreso = 'Verificando tu conexión...';
    });

    try {
      await ref.read(apiClientProvider).exigirConexion();

      if (!mounted) return;
      setState(() => _progreso = 'Obteniendo tu ubicación...');

      final lectura = await ref.read(locationServiceProvider).obtener(
            precisionMaxima: widget.estado.precisionMaximaMetros,
            antiguedadMaximaSegundos: widget.estado.antiguedadMaximaSegundos,
            onProgreso: (mensaje, _) {
              if (mounted) setState(() => _progreso = mensaje);
            },
          );

      if (!mounted) return;
      setState(() {
        _ubicacion = lectura;
        _paso = PasoMarcacion.revisionUbicacion;
      });

      // Estar fuera del radio tambien es un intento, y el telefono lo corta
      // aqui: si no se avisa, el servidor nunca se entera de que alguien quiso
      // marcar desde otro sitio.
      if (!_dentroDeGeocerca) _informarFueraDeGeocerca(lectura);
    } on AppException catch (e) {
      _informarIncidente(e);
      if (mounted) setState(() => _error = e);
    } catch (e) {
      if (mounted) {
        setState(() => _error = AppException(
              code: 'ERROR_INTERNO',
              message: 'No se pudo obtener tu ubicación: $e',
            ));
      }
    }
  }

  /// Los intentos detenidos en el telefono tambien deben quedar registrados en
  /// el servidor: una ubicacion simulada se notifica al administrador de
  /// inmediato. Si el aviso falla (por ejemplo, sin conexion) no se insiste: la
  /// persona ya esta viendo el motivo del rechazo.
  void _informarIncidente(AppException e) {
    if (e.code != 'UBICACION_SIMULADA' && e.code != 'GPS_IMPRECISO') return;
    ref
        .read(attendanceServiceProvider)
        .reportarIncidente(tipo: e.code, esEntrada: widget.esEntrada, meta: e.meta)
        .catchError((Object _) {});
  }

  /// Igual que el anterior, pero para el rechazo por geocerca, que no llega
  /// como excepcion sino como una lectura valida en el lugar equivocado.
  void _informarFueraDeGeocerca(LecturaUbicacion lectura) {
    ref
        .read(attendanceServiceProvider)
        .reportarIncidente(
          tipo: 'FUERA_DE_GEOCERCA',
          esEntrada: widget.esEntrada,
          meta: {
            'latitud': lectura.latitud,
            'longitud': lectura.longitud,
            'precision': lectura.precisionMetros,
            'distancia': _distancia,
          },
        )
        .catchError((Object _) {});
  }

  double get _distancia {
    final u = _ubicacion;
    if (u == null) return double.infinity;
    return ref.read(locationServiceProvider).distanciaMetros(
          widget.estado.sede.latitud,
          widget.estado.sede.longitud,
          u.latitud,
          u.longitud,
        );
  }

  bool get _dentroDeGeocerca => _distancia <= widget.estado.sede.radioMetros;

  // ---------------------------------------------------------------------------
  // Paso 2: camara
  // ---------------------------------------------------------------------------

  Future<void> _abrirCamara() async {
    setState(() {
      _paso = PasoMarcacion.camara;
      _error = null;
      _camaraLista = false;
    });

    try {
      final servicio = ref.read(cameraServiceProvider);
      await servicio.asegurarPermiso();

      final camaras = await servicio.camarasDisponibles();
      final elegida = servicio.preferirFrontal(camaras);

      final controlador = CameraController(
        elegida,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );

      await controlador.initialize();

      if (!mounted) {
        await controlador.dispose();
        return;
      }

      setState(() {
        _camara = controlador;
        _camaraLista = true;
      });
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e);
    } on CameraException {
      if (mounted) {
        setState(() => _error = const AppException(
              code: 'CAMARA_NO_DISPONIBLE',
              message: 'No se pudo abrir la cámara de tu teléfono.',
            ));
      }
    }
  }

  Future<void> _capturar() async {
    final controlador = _camara;
    if (controlador == null || !controlador.value.isInitialized) return;
    if (_capturando) return;

    setState(() => _capturando = true);

    try {
      final captura = await controlador.takePicture();
      final evidencia = await ref.read(cameraServiceProvider).procesar(captura);

      await controlador.dispose();

      if (!mounted) return;
      setState(() {
        _camara = null;
        _camaraLista = false;
        _evidencia = evidencia;
        _paso = PasoMarcacion.revisionFoto;
      });
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e);
    } catch (e) {
      if (mounted) {
        setState(() => _error = AppException(
              code: 'EVIDENCIA_INVALIDA',
              message: 'No se pudo tomar la fotografía: $e',
            ));
      }
    } finally {
      if (mounted) setState(() => _capturando = false);
    }
  }

  Future<void> _repetirFoto() async {
    setState(() => _evidencia = null);
    await _abrirCamara();
  }

  // ---------------------------------------------------------------------------
  // Paso 3: envio
  // ---------------------------------------------------------------------------

  Future<void> _enviar() async {
    final ubicacion = _ubicacion;
    final evidencia = _evidencia;
    final practicanteId = ref.read(usuarioProvider)?.practicante?.id;

    if (ubicacion == null || evidencia == null || practicanteId == null) return;

    setState(() {
      _paso = PasoMarcacion.enviando;
      _error = null;
      _progreso = 'Registrando tu ${widget.esEntrada ? "entrada" : "salida"}...';
    });

    try {
      final resultado = await ref.read(attendanceServiceProvider).marcar(
            esEntrada: widget.esEntrada,
            ubicacion: ubicacion,
            evidencia: evidencia,
            fechaNegocio: widget.estado.fechaNegocio,
            practicanteId: practicanteId,
          );

      if (!mounted) return;
      setState(() {
        _resultado = resultado;
        _paso = PasoMarcacion.resultado;
      });
    } on AppException catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _paso = PasoMarcacion.revisionFoto;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = AppException(
            code: 'ERROR_INTERNO',
            message: 'No se pudo registrar la marcación: $e',
          );
          _paso = PasoMarcacion.revisionFoto;
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Interfaz
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    // Salir a mitad del flujo no registra nada: la marcacion solo existe
    // cuando el servidor la confirma.
    return PopScope(
      canPop: _paso != PasoMarcacion.enviando,
      child: Scaffold(
        appBar: AppBar(
          title: Text(_titulo),
          leading: _paso == PasoMarcacion.enviando
              ? null
              : IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.of(context)
                      .pop(_paso == PasoMarcacion.resultado),
                ),
        ),
        body: SafeArea(child: _construirPaso()),
      ),
    );
  }

  Widget _construirPaso() {
    if (_error != null && _paso != PasoMarcacion.revisionFoto) {
      return _VistaErrorMarcacion(
        error: _error!,
        onReintentar: _paso == PasoMarcacion.camara
            ? _abrirCamara
            : _obtenerUbicacion,
        onAjustes: () async {
          final codigo = _error!.code;
          if (codigo == 'GPS_APAGADO') {
            await ref.read(locationServiceProvider).abrirAjustesUbicacion();
          } else if (codigo.startsWith('PERMISO_CAMARA')) {
            await ref.read(cameraServiceProvider).abrirAjustes();
          } else {
            await ref.read(locationServiceProvider).abrirAjustesAplicacion();
          }
        },
        onCancelar: () => Navigator.of(context).pop(false),
      );
    }

    return switch (_paso) {
      PasoMarcacion.ubicacion => _PasoCargando(
          mensaje: _progreso,
          detalle:
              'Se requiere una precisión de ${widget.estado.precisionMaximaMetros.round()} m o mejor.',
        ),
      PasoMarcacion.revisionUbicacion => _PasoRevisionUbicacion(
          ubicacion: _ubicacion!,
          sede: widget.estado.sede,
          distancia: _distancia,
          dentro: _dentroDeGeocerca,
          onContinuar: _abrirCamara,
          onReintentar: _obtenerUbicacion,
        ),
      PasoMarcacion.camara => _PasoCamara(
          controlador: _camara,
          lista: _camaraLista,
          capturando: _capturando,
          esEntrada: widget.esEntrada,
          onCapturar: _capturar,
        ),
      PasoMarcacion.revisionFoto => _PasoRevisionFoto(
          evidencia: _evidencia!,
          ubicacion: _ubicacion!,
          distancia: _distancia,
          esEntrada: widget.esEntrada,
          error: _error,
          onRepetir: _repetirFoto,
          onConfirmar: _enviar,
        ),
      PasoMarcacion.enviando => _PasoCargando(
          mensaje: _progreso,
          detalle: 'No cierres la aplicación.',
        ),
      PasoMarcacion.resultado => _PasoResultado(
          resultado: _resultado!,
          sede: widget.estado.sede.nombre,
          onCerrar: () => Navigator.of(context).pop(true),
        ),
    };
  }
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

class _PasoCargando extends StatelessWidget {
  const _PasoCargando({required this.mensaje, this.detalle});
  final String mensaje;
  final String? detalle;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(
              width: 48,
              height: 48,
              child: CircularProgressIndicator(strokeWidth: 3),
            ),
            const SizedBox(height: 28),
            Text(
              mensaje,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Color(0xFF334155),
              ),
            ),
            if (detalle != null) ...[
              const SizedBox(height: 8),
              Text(
                detalle!,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PasoRevisionUbicacion extends StatelessWidget {
  const _PasoRevisionUbicacion({
    required this.ubicacion,
    required this.sede,
    required this.distancia,
    required this.dentro,
    required this.onContinuar,
    required this.onReintentar,
  });

  final LecturaUbicacion ubicacion;
  final Sede sede;
  final double distancia;
  final bool dentro;
  final VoidCallback onContinuar;
  final VoidCallback onReintentar;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Aviso(
                titulo: dentro ? 'Estás dentro de tu sede' : 'Estás fuera del radio',
                mensaje: dentro
                    ? 'Ubicación verificada. Continua para tomar la fotografía.'
                    : 'Debes estar dentro de tu sede para registrar asistencia. '
                        'Estás a ${distancia.round()} m y el máximo permitido es ${sede.radioMetros} m.',
                tono: dentro ? TonoAviso.exito : TonoAviso.peligro,
              ),
              const SizedBox(height: 14),

              // Mapa: la sede, su radio y donde esta la persona.
              SizedBox(
                height: 230,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: _MapaUbicacion(
                    sede: sede,
                    ubicacion: ubicacion,
                    dentro: dentro,
                  ),
                ),
              ),
              const SizedBox(height: 14),

              TarjetaSeccion(
                titulo: 'Datos de tu ubicación',
                child: Column(
                  children: [
                    FilaDato(
                      etiqueta: 'Distancia a la sede',
                      valor: '${distancia.round()} m',
                      destacado: true,
                    ),
                    FilaDato(
                      etiqueta: 'Radio permitido',
                      valor: '${sede.radioMetros} m',
                    ),
                    FilaDato(
                      etiqueta: 'Precisión del GPS',
                      valor: '${ubicacion.precisionMetros.round()} m',
                    ),
                    FilaDato(
                      etiqueta: 'Coordenadas',
                      valor:
                          '${ubicacion.latitud.toStringAsFixed(5)}, ${ubicacion.longitud.toStringAsFixed(5)}',
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              if (dentro)
                FilledButton.icon(
                  onPressed: onContinuar,
                  icon: const Icon(Icons.photo_camera_rounded),
                  label: const Text('Continuar y tomar fotografía'),
                )
              else
                FilledButton.icon(
                  onPressed: onReintentar,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Ya estoy en la sede, reintentar'),
                ),
              const SizedBox(height: 8),
              if (dentro)
                TextButton.icon(
                  onPressed: onReintentar,
                  icon: const Icon(Icons.my_location_rounded, size: 18),
                  label: const Text('Actualizar ubicación'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _MapaUbicacion extends StatelessWidget {
  const _MapaUbicacion({
    required this.sede,
    required this.ubicacion,
    required this.dentro,
  });

  final Sede sede;
  final LecturaUbicacion ubicacion;
  final bool dentro;

  @override
  Widget build(BuildContext context) {
    final centroSede = LatLng(sede.latitud, sede.longitud);
    final miPosicion = LatLng(ubicacion.latitud, ubicacion.longitud);
    final colorPunto = dentro ? ColoresEstado.exito : ColoresEstado.peligro;

    return FlutterMap(
      options: MapOptions(
        initialCenter: dentro ? centroSede : miPosicion,
        initialZoom: sede.radioMetros <= 60 ? 17.5 : 16,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
        ),
      ),
      children: [
        TileLayer(
          urlTemplate: AppConfig.mapTileUrl,
          userAgentPackageName: AppConfig.mapUserAgent,
        ),
        CircleLayer(
          circles: [
            // Geocerca de la sede.
            CircleMarker(
              point: centroSede,
              radius: sede.radioMetros.toDouble(),
              useRadiusInMeter: true,
              // ignore: deprecated_member_use
              color: ColoresEstado.marcaClara.withOpacity(0.15),
              borderColor: ColoresEstado.marca,
              borderStrokeWidth: 2,
            ),
            // Incertidumbre de la lectura GPS.
            CircleMarker(
              point: miPosicion,
              radius: ubicacion.precisionMetros,
              useRadiusInMeter: true,
              // ignore: deprecated_member_use
              color: colorPunto.withOpacity(0.12),
              borderColor: colorPunto,
              borderStrokeWidth: 1,
            ),
          ],
        ),
        PolylineLayer(
          polylines: [
            Polyline(
              points: [centroSede, miPosicion],
              color: colorPunto,
              strokeWidth: 2,
            ),
          ],
        ),
        MarkerLayer(
          markers: [
            Marker(
              point: centroSede,
              width: 34,
              height: 34,
              child: const _PinMapa(
                color: ColoresEstado.marca,
                icono: Icons.business_rounded,
              ),
            ),
            Marker(
              point: miPosicion,
              width: 34,
              height: 34,
              child: _PinMapa(color: colorPunto, icono: Icons.person_rounded),
            ),
          ],
        ),
      ],
    );
  }
}

class _PinMapa extends StatelessWidget {
  const _PinMapa({required this.color, required this.icono});
  final Color color;
  final IconData icono;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2.5),
        boxShadow: const [
          BoxShadow(color: Colors.black26, blurRadius: 4, offset: Offset(0, 2)),
        ],
      ),
      child: Icon(icono, color: Colors.white, size: 16),
    );
  }
}

class _PasoCamara extends StatelessWidget {
  const _PasoCamara({
    required this.controlador,
    required this.lista,
    required this.capturando,
    required this.esEntrada,
    required this.onCapturar,
  });

  final CameraController? controlador;
  final bool lista;
  final bool capturando;
  final bool esEntrada;
  final VoidCallback onCapturar;

  @override
  Widget build(BuildContext context) {
    if (!lista || controlador == null) {
      return const _PasoCargando(
        mensaje: 'Abriendo la cámara...',
        detalle: 'La fotografía se toma en el momento, no se puede elegir de la galeria.',
      );
    }

    return Column(
      children: [
        Container(
          width: double.infinity,
          color: ColoresEstado.marca,
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
          child: Text(
            'Mira a la cámara y toma tu fotografía de ${esEntrada ? "entrada" : "salida"}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 14),
          ),
        ),
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              ClipRect(
                child: OverflowBox(
                  alignment: Alignment.center,
                  child: FittedBox(
                    fit: BoxFit.cover,
                    child: SizedBox(
                      width: controlador!.value.previewSize?.height ?? 1080,
                      height: controlador!.value.previewSize?.width ?? 1440,
                      child: CameraPreview(controlador!),
                    ),
                  ),
                ),
              ),
              // Guia visual para encuadrar el rostro.
              IgnorePointer(
                child: Container(
                  width: 220,
                  height: 280,
                  decoration: BoxDecoration(
                    border: Border.all(
                      // ignore: deprecated_member_use
                      color: Colors.white.withOpacity(0.7),
                      width: 2,
                    ),
                    borderRadius: BorderRadius.circular(140),
                  ),
                ),
              ),
            ],
          ),
        ),
        Container(
          color: Colors.black,
          padding: const EdgeInsets.symmetric(vertical: 24),
          width: double.infinity,
          child: Center(
            child: GestureDetector(
              onTap: capturando ? null : onCapturar,
              child: Container(
                width: 74,
                height: 74,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: capturando ? Colors.grey : Colors.white,
                  border: Border.all(color: Colors.white38, width: 5),
                ),
                child: capturando
                    ? const Padding(
                        padding: EdgeInsets.all(20),
                        child: CircularProgressIndicator(
                          strokeWidth: 3,
                          color: ColoresEstado.marca,
                        ),
                      )
                    : const Icon(Icons.camera_alt_rounded,
                        color: ColoresEstado.marca, size: 30),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _PasoRevisionFoto extends StatelessWidget {
  const _PasoRevisionFoto({
    required this.evidencia,
    required this.ubicacion,
    required this.distancia,
    required this.esEntrada,
    required this.onRepetir,
    required this.onConfirmar,
    this.error,
  });

  final EvidenciaCapturada evidencia;
  final LecturaUbicacion ubicacion;
  final double distancia;
  final bool esEntrada;
  final AppException? error;
  final VoidCallback onRepetir;
  final VoidCallback onConfirmar;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (error != null) ...[
                Aviso(
                  titulo: 'No se pudo registrar',
                  mensaje: error!.message,
                  tono: TonoAviso.peligro,
                ),
                const SizedBox(height: 14),
              ],
              const Text(
                'Revisa tu fotografía',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF0F172A),
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Debe verse tu rostro con claridad. Si no es así, repitela.',
                style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 14),
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Image.memory(
                  evidencia.bytes,
                  height: 340,
                  width: double.infinity,
                  fit: BoxFit.cover,
                ),
              ),
              const SizedBox(height: 14),
              TarjetaSeccion(
                titulo: 'Lo que se enviará',
                child: Column(
                  children: [
                    FilaDato(
                      etiqueta: 'Tipo de marcación',
                      valor: esEntrada ? 'Entrada' : 'Salida',
                      destacado: true,
                    ),
                    FilaDato(
                      etiqueta: 'Distancia a la sede',
                      valor: '${distancia.round()} m',
                    ),
                    FilaDato(
                      etiqueta: 'Precisión del GPS',
                      valor: '${ubicacion.precisionMetros.round()} m',
                    ),
                    FilaDato(
                      etiqueta: 'Tamaño de la fotografía',
                      valor: '${evidencia.tamanoKb} KB',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'La hora oficial de tu marcación la registra el servidor, no tu teléfono.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              FilledButton.icon(
                onPressed: onConfirmar,
                icon: const Icon(Icons.check_rounded),
                label: Text('Confirmar ${esEntrada ? "entrada" : "salida"}'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: onRepetir,
                icon: const Icon(Icons.replay_rounded),
                label: const Text('Repetir fotografía'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PasoResultado extends StatelessWidget {
  const _PasoResultado({
    required this.resultado,
    required this.sede,
    required this.onCerrar,
  });

  final ResultadoMarcacion resultado;
  final String sede;
  final VoidCallback onCerrar;

  @override
  Widget build(BuildContext context) {
    final tarde = resultado.esTardanza;
    final color = tarde ? ColoresEstado.aviso : ColoresEstado.exito;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const SizedBox(height: 20),
              Center(
                child: Container(
                  width: 92,
                  height: 92,
                  decoration: BoxDecoration(
                    // ignore: deprecated_member_use
                    color: color.withOpacity(0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    tarde ? Icons.schedule_rounded : Icons.check_circle_rounded,
                    size: 52,
                    color: color,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                resultado.duplicada
                    ? 'Tu marcación ya estába registrada'
                    : resultado.esEntrada
                        ? (tarde ? 'Entrada registrada con tardanza' : 'Entrada registrada')
                        : 'Salida registrada',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF0F172A),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Hora registrada por el servidor: ${resultado.horaLocal}',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 24),

              TarjetaSeccion(
                child: Column(
                  children: [
                    FilaDato(etiqueta: 'Sede', valor: sede),
                    if (resultado.horaProgramada != null)
                      FilaDato(
                        etiqueta: 'Hora programada',
                        valor: resultado.horaProgramada!,
                      ),
                    FilaDato(
                      etiqueta: 'Hora registrada',
                      valor: resultado.horaLocal,
                      destacado: true,
                    ),
                    if (resultado.esEntrada)
                      FilaDato(
                        etiqueta: 'Clasificación',
                        valor: tarde
                            ? 'Tardanza (${resultado.minutosTardanza} min)'
                            : 'Puntual',
                        destacado: true,
                      ),
                    FilaDato(
                      etiqueta: 'Distancia a la sede',
                      valor: '${resultado.distanciaMetros.round()} m',
                    ),
                  ],
                ),
              ),

              if (resultado.duplicada) ...[
                const SizedBox(height: 14),
                const Aviso(
                  mensaje:
                      'Ya habías registrado esta marcación. No se creó un registro duplicado.',
                  tono: TonoAviso.info,
                ),
              ],

              if (resultado.esEntrada && !resultado.duplicada) ...[
                const SizedBox(height: 14),
                const Aviso(
                  mensaje: 'Recuerda marcar tu salida antes de retirarte.',
                  tono: TonoAviso.info,
                ),
              ],
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: onCerrar,
            child: const Text('Listo'),
          ),
        ),
      ],
    );
  }
}

class _VistaErrorMarcacion extends StatelessWidget {
  const _VistaErrorMarcacion({
    required this.error,
    required this.onReintentar,
    required this.onAjustes,
    required this.onCancelar,
  });

  final AppException error;
  final VoidCallback onReintentar;
  final VoidCallback onAjustes;
  final VoidCallback onCancelar;

  @override
  Widget build(BuildContext context) {
    final critico = error.code == 'UBICACION_SIMULADA' ||
        error.code == 'DISPOSITIVO_NO_AUTORIZADO';

    final icono = switch (error.code) {
      'SIN_CONEXION' => Icons.wifi_off_rounded,
      'UBICACION_SIMULADA' => Icons.gpp_bad_rounded,
      'GPS_APAGADO' || 'GPS_SIN_LECTURA' => Icons.location_off_rounded,
      'GPS_IMPRECISO' || 'GPS_OBSOLETO' => Icons.gps_not_fixed_rounded,
      'FUERA_DE_GEOCERCA' => Icons.wrong_location_rounded,
      'DISPOSITIVO_NO_AUTORIZADO' => Icons.phonelink_lock_rounded,
      _ when error.code.startsWith('PERMISO_CAMARA') => Icons.no_photography_rounded,
      _ when error.code.startsWith('PERMISO_UBICACION') => Icons.location_disabled_rounded,
      _ => Icons.error_outline_rounded,
    };

    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            icono,
            size: 64,
            color: critico ? ColoresEstado.peligro : ColoresEstado.aviso,
          ),
          const SizedBox(height: 24),
          Text(
            error.message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 16,
              height: 1.5,
              color: Color(0xFF334155),
            ),
          ),

          if (critico) ...[
            const SizedBox(height: 16),
            const Aviso(
              mensaje:
                  'Este intento quedó registrado y se notifico al administrador.',
              tono: TonoAviso.peligro,
            ),
          ],

          const SizedBox(height: 28),

          if (ErrorCatalog.abreAjustes(error.code))
            FilledButton.icon(
              onPressed: onAjustes,
              icon: const Icon(Icons.settings_rounded),
              label: const Text('Abrir ajustes'),
            )
          else if (ErrorCatalog.esReintentable(error.code) ||
              error.code == 'FUERA_DE_GEOCERCA')
            FilledButton.icon(
              onPressed: onReintentar,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Reintentar'),
            ),

          const SizedBox(height: 8),
          TextButton(onPressed: onCancelar, child: const Text('Cancelar')),
        ],
      ),
    );
  }
}
