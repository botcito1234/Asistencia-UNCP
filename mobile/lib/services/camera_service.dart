/// Captura de la evidencia fotográfica.
///
/// Requisito de negocio: la fotografia se toma EN EL MOMENTO, con la camara.
/// Por eso no se usa image_picker ni ningun selector de archivos: no existe
/// ninguna ruta en la aplicacion que permita elegir una imagen de la galeria,
/// del explorador de archivos ni de otra aplicacion.
///
/// La imagen se comprime antes de subirla para que la marcacion funcione con
/// datos moviles, conservando resolucion suficiente para reconocer a la persona.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/config.dart';
import '../core/errors.dart';

class EvidenciaCapturada {
  const EvidenciaCapturada({
    required this.bytes,
    required this.nombreArchivo,
    required this.momento,
  });

  final Uint8List bytes;
  final String nombreArchivo;
  final DateTime momento;

  int get tamanoKb => (bytes.length / 1024).round();
}

class CameraService {
  const CameraService();

  Future<void> asegurarPermiso() async {
    final estado = await Permission.camera.status;

    if (estado.isPermanentlyDenied) {
      throw const LocalException(
        'PERMISO_CAMARA_PERMANENTE',
        'El permiso de cámara está bloqueado. Habílitalo desde los ajustes del teléfono.',
      );
    }

    if (!estado.isGranted) {
      final resultado = await Permission.camera.request();
      if (resultado.isPermanentlyDenied) {
        throw const LocalException(
          'PERMISO_CAMARA_PERMANENTE',
          'El permiso de cámara está bloqueado. Habílitalo desde los ajustes del teléfono.',
        );
      }
      if (!resultado.isGranted) {
        throw const LocalException(
          'PERMISO_CAMARA_DENEGADO',
          'Necesitamos la cámara para registrar la evidencia de tu asistencia.',
        );
      }
    }
  }

  /// Camaras disponibles. Se prefiere la frontal: la evidencia es de la persona
  /// que marca, no del entorno.
  Future<List<CameraDescription>> camarasDisponibles() async {
    try {
      final camaras = await availableCameras();
      if (camaras.isEmpty) {
        throw const LocalException(
          'CAMARA_NO_DISPONIBLE',
          'Este teléfono no tiene una cámara utilizable.',
        );
      }
      return camaras;
    } on CameraException {
      throw const LocalException(
        'CAMARA_NO_DISPONIBLE',
        'No se pudo acceder a la cámara de tu teléfono.',
      );
    }
  }

  CameraDescription preferirFrontal(List<CameraDescription> camaras) {
    return camaras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => camaras.first,
    );
  }

  /// Comprime la captura y devuelve los bytes listos para subir.
  Future<EvidenciaCapturada> procesar(XFile captura) async {
    final original = File(captura.path);

    Uint8List bytes;
    try {
      final comprimida = await FlutterImageCompress.compressWithFile(
        original.absolute.path,
        quality: AppConfig.photoQuality,
        minWidth: AppConfig.photoMaxWidth,
        minHeight: AppConfig.photoMaxHeight,
        format: CompressFormat.jpeg,
        // La camara frontal entrega la imagen rotada segun la orientacion del
        // sensor; se corrige para que la evidencia se vea derecha.
        autoCorrectionAngle: true,
      );
      bytes = comprimida ?? await original.readAsBytes();
    } catch (_) {
      // Si la compresion falla, se sube el original antes que perder la
      // evidencia: el servidor valida tamano y formato igualmente.
      bytes = await original.readAsBytes();
    }

    if (bytes.isEmpty) {
      throw const LocalException(
        'EVIDENCIA_INVALIDA',
        'La fotografía no se pudo procesar. Vuelve a tomarla.',
      );
    }

    // El archivo temporal de la camara ya no hace falta.
    await _borrarSilencioso(original);

    return EvidenciaCapturada(
      bytes: bytes,
      nombreArchivo:
          'evidencia_${DateTime.now().millisecondsSinceEpoch}.jpg',
      momento: DateTime.now(),
    );
  }

  Future<void> _borrarSilencioso(File archivo) async {
    try {
      if (await archivo.exists()) await archivo.delete();
    } catch (_) {
      // Un temporal que no se puede borrar no debe romper la marcacion.
    }
  }

  /// Limpia los temporales que la camara pudiera haber dejado.
  Future<void> limpiarTemporales() async {
    try {
      final dir = await getTemporaryDirectory();
      final limite = DateTime.now().subtract(const Duration(hours: 6));
      await for (final entidad in dir.list()) {
        if (entidad is! File) continue;
        if (!entidad.path.toLowerCase().endsWith('.jpg')) continue;
        final stat = await entidad.stat();
        if (stat.modified.isBefore(limite)) await _borrarSilencioso(entidad);
      }
    } catch (_) {
      // Tarea de mantenimiento: si falla, no afecta a nada.
    }
  }

  Future<void> abrirAjustes() => openAppSettings();
}
