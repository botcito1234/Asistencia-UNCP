/// Pruebas de la aplicacion movil.
///
/// Se centran en la logica que decide que ve y que puede hacer el usuario, que
/// es donde un error tendria consecuencias reales. Las validaciones de negocio
/// (ventana de entrada, geocerca, precision) se prueban de extremo a extremo en
/// el backend, contra PostgreSQL real.
library;

import 'package:asistencia_app/core/errors.dart';
import 'package:asistencia_app/core/theme.dart';
import 'package:asistencia_app/models/models.dart';
import 'package:asistencia_app/widgets/comunes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Catalogo de errores', () {
    test('cada código conocido tiene un mensaje útil para la persona', () {
      const codigos = [
        'SIN_CONEXION',
        'DISPOSITIVO_NO_AUTORIZADO',
        'UBICACION_SIMULADA',
        'GPS_IMPRECISO',
        'FUERA_DE_GEOCERCA',
        'ENTRADA_DUPLICADA',
        'SALIDA_SIN_ENTRADA',
        'EVIDENCIA_REQUERIDA',
      ];

      for (final codigo in codigos) {
        final mensaje = ErrorCatalog.mensaje(codigo);
        expect(mensaje, isNotEmpty, reason: 'falta mensaje para $codigo');
        expect(mensaje.length, greaterThan(15),
            reason: '$codigo tiene un mensaje demasiado escueto');
      }
    });

    test('el mensaje del servidor tiene prioridad porque trae datos concretos', () {
      final mensaje = ErrorCatalog.mensaje(
        'FUERA_DE_GEOCERCA',
        mensajeServidor: 'Estás a 187 m (máximo 50 m).',
      );
      expect(mensaje, contains('187'));
    });

    test('un código desconocido no deja al usuario sin explicacion', () {
      expect(ErrorCatalog.mensaje('CODIGO_QUE_NO_EXISTE'), isNotEmpty);
    });

    test('los fallos de red y de señal admiten reintento', () {
      expect(ErrorCatalog.esReintentable('SIN_CONEXION'), isTrue);
      expect(ErrorCatalog.esReintentable('GPS_IMPRECISO'), isTrue);
      // Una entrada duplicada no se arregla reintentando.
      expect(ErrorCatalog.esReintentable('ENTRADA_DUPLICADA'), isFalse);
    });

    test('los errores de sesión y de dispositivo obligan a reautenticar', () {
      expect(ErrorCatalog.exigeReautenticacion('SESION_REVOCADA'), isTrue);
      expect(ErrorCatalog.exigeReautenticacion('DISPOSITIVO_NO_AUTORIZADO'), isTrue);
      expect(ErrorCatalog.exigeReautenticacion('GPS_IMPRECISO'), isFalse);
    });

    test('los permisos bloqueados ofrecen abrir los ajustes del sistema', () {
      expect(ErrorCatalog.abreAjustes('PERMISO_CAMARA_PERMANENTE'), isTrue);
      expect(ErrorCatalog.abreAjustes('GPS_APAGADO'), isTrue);
      expect(ErrorCatalog.abreAjustes('SIN_CONEXION'), isFalse);
    });
  });

  group('Colores de estado', () {
    test('una falta se muestra en rojo', () {
      expect(ColoresEstado.deEstado('AUSENTE'), ColoresEstado.peligro);
    });

    test('una entrada puntual se muestra en verde', () {
      expect(
        ColoresEstado.deEstado('PRESENTE', puntualidad: 'PUNTUAL'),
        ColoresEstado.exito,
      );
    });

    test('una tardanza se distingue de una entrada puntual', () {
      final puntual =
          ColoresEstado.deEstado('PRESENTE', puntualidad: 'PUNTUAL');
      final tardanza =
          ColoresEstado.deEstado('PRESENTE', puntualidad: 'TARDANZA');
      expect(tardanza, ColoresEstado.aviso);
      expect(tardanza, isNot(puntual));
    });

    test('un evento critico se distingue de una advertencia', () {
      expect(ColoresEstado.deSeveridad('CRITICO'), ColoresEstado.peligro);
      expect(ColoresEstado.deSeveridad('ADVERTENCIA'), ColoresEstado.aviso);
      expect(ColoresEstado.deSeveridad('INFO'), ColoresEstado.info);
    });
  });

  group('Lectura del estado del día', () {
    Map<String, dynamic> respuestaBase({
      bool puedeEntrar = true,
      bool puedeSalir = false,
      String estado = 'PROGRAMADO',
      String? puntualidad,
      Map<String, dynamic>? entrada,
    }) =>
        {
          'businessDate': '2026-09-18',
          'serverTime': '2026-09-18T13:00:00.000Z',
          'localTime': '08:00:00',
          'timezone': 'America/Lima',
          'site': {
            'id': 's1',
            'code': 'SEDE-01',
            'name': 'Sede Central',
            'latitude': -12.046374,
            'longitude': -77.042793,
            'radiusMeters': 50,
            'timezone': 'America/Lima',
          },
          'schedule': {
            'startTime': '08:00',
            'endTime': '17:00',
            'hasSchedule': true,
          },
          'checkIn': entrada,
          'checkOut': null,
          'status': estado,
          'punctuality': puntualidad,
          'lateMinutes': 0,
          'pendingExit': false,
          'actions': {
            'canCheckIn': puedeEntrar,
            'canCheckOut': puedeSalir,
            'checkInOpensAt': '07:45',
            'reason': null,
          },
          'gpsRequirements': {'maxAccuracyMeters': 35, 'maxAgeSeconds': 60},
        };

    test('interpreta la jornada programada y la ventana de entrada', () {
      final estado = EstadoHoy.desdeJson(respuestaBase());

      expect(estado.tieneHorario, isTrue);
      expect(estado.horaEntradaProgramada, '08:00');
      expect(estado.abreA, '07:45');
      expect(estado.puedeMarcarEntrada, isTrue);
      expect(estado.puedeMarcarSalida, isFalse);
      expect(estado.sede.radioMetros, 50);
      expect(estado.precisionMaximaMetros, 35);
    });

    test('lee la marcación de entrada con su distancia', () {
      final estado = EstadoHoy.desdeJson(respuestaBase(
        puedeEntrar: false,
        puedeSalir: true,
        estado: 'PRESENTE',
        puntualidad: 'PUNTUAL',
        entrada: {
          'id': 'm1',
          'time': '2026-09-18T13:00:00.000Z',
          'localTime': '08:00',
          'distanceMeters': 12.5,
          'accuracyMeters': 8.0,
          'latitude': -12.046374,
          'longitude': -77.042793,
          'evidenceId': 'e1',
        },
      ));

      expect(estado.entrada, isNotNull);
      expect(estado.entrada!.distanciaMetros, 12.5);
      expect(estado.entrada!.horaLocal, '08:00');
      expect(estado.puedeMarcarSalida, isTrue);
    });

    test('sin horario no habilita ninguna marcación', () {
      final json = respuestaBase(puedeEntrar: false);
      json['schedule'] = {
        'startTime': null,
        'endTime': null,
        'hasSchedule': false,
      };
      final estado = EstadoHoy.desdeJson(json);

      expect(estado.tieneHorario, isFalse);
      expect(estado.puedeMarcarEntrada, isFalse);
      expect(estado.puedeMarcarSalida, isFalse);
    });
  });

  group('Lectura del resultado de una marcación', () {
    test('reconoce una entrada puntual', () {
      final resultado = ResultadoMarcacion.desdeJson({
        'type': 'ENTRADA',
        'businessDate': '2026-09-18',
        'localTime': '07:52',
        'punctuality': 'PUNTUAL',
        'lateMinutes': 0,
        'distanceMeters': 8.4,
        'accuracyMeters': 6.0,
        'deduplicated': false,
        'scheduledStartTime': '08:00',
      });

      expect(resultado.esEntrada, isTrue);
      expect(resultado.esTardanza, isFalse);
      expect(resultado.duplicada, isFalse);
    });

    test('reconoce una tardanza con sus minutos', () {
      final resultado = ResultadoMarcacion.desdeJson({
        'type': 'ENTRADA',
        'businessDate': '2026-09-18',
        'localTime': '08:23',
        'punctuality': 'TARDANZA',
        'lateMinutes': 23,
        'distanceMeters': 11.0,
        'accuracyMeters': 7.0,
        'deduplicated': false,
      });

      expect(resultado.esTardanza, isTrue);
      expect(resultado.minutosTardanza, 23);
    });

    test('reconoce una respuesta deduplicada tras un reintento', () {
      final resultado = ResultadoMarcacion.desdeJson({
        'type': 'ENTRADA',
        'businessDate': '2026-09-18',
        'localTime': '07:52',
        'punctuality': 'PUNTUAL',
        'lateMinutes': 0,
        'distanceMeters': 8.4,
        'accuracyMeters': 6.0,
        'deduplicated': true,
      });

      expect(resultado.duplicada, isTrue);
    });
  });

  group('Usuario y rol', () {
    test('distingue administrador de practicante', () {
      final admin = Usuario.desdeJson({
        'id': 'u1',
        'dni': '00000000',
        'role': 'ADMINISTRADOR',
        'displayName': 'Administrador General',
        'mustChangePassword': false,
        'intern': null,
      });

      expect(admin.esAdministrador, isTrue);
      expect(admin.esPracticante, isFalse);
      expect(admin.practicante, isNull);
    });

    test('un practicante trae su sede y su estado de consentimiento', () {
      final practicante = Usuario.desdeJson({
        'id': 'u2',
        'dni': '40000001',
        'role': 'PRACTICANTE',
        'displayName': 'Ana Quispe',
        'mustChangePassword': true,
        'intern': {
          'id': 'i1',
          'firstNames': 'Ana',
          'lastNames': 'Quispe Mamani',
          'areaGroup': 'Aula A',
          'consentAccepted': false,
          'site': {
            'id': 's1',
            'code': 'SEDE-01',
            'name': 'Sede Central',
            'latitude': -12.046374,
            'longitude': -77.042793,
            'radiusMeters': 50,
            'timezone': 'America/Lima',
          },
        },
      });

      expect(practicante.esPracticante, isTrue);
      expect(practicante.debeCambiarPassword, isTrue);
      expect(practicante.practicante!.consentimientoAceptado, isFalse);
      expect(practicante.practicante!.sede.radioMetros, 50);
    });

    test('la serializacion de ida y vuelta conserva los datos', () {
      final original = Usuario.desdeJson({
        'id': 'u2',
        'dni': '40000001',
        'role': 'PRACTICANTE',
        'displayName': 'Ana Quispe',
        'mustChangePassword': false,
        'intern': {
          'id': 'i1',
          'firstNames': 'Ana',
          'lastNames': 'Quispe Mamani',
          'areaGroup': 'Aula A',
          'consentAccepted': true,
          'site': {
            'id': 's1',
            'code': 'SEDE-01',
            'name': 'Sede Central',
            'latitude': -12.046374,
            'longitude': -77.042793,
            'radiusMeters': 50,
            'timezone': 'America/Lima',
          },
        },
      });

      final reconstruido = Usuario.desdeJson(original.aJson());
      expect(reconstruido.dni, original.dni);
      expect(reconstruido.practicante!.sede.latitud,
          original.practicante!.sede.latitud);
    });
  });

  group('Componentes de interfaz', () {
    testWidgets('la etiqueta de falta se lee como "Falta"', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: Etiqueta.estado('AUSENTE'))),
      );
      expect(find.text('Falta'), findsOneWidget);
    });

    testWidgets('la etiqueta distingue puntual de tardanza', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                Etiqueta.estado('PRESENTE', puntualidad: 'PUNTUAL'),
                Etiqueta.estado('PRESENTE', puntualidad: 'TARDANZA'),
              ],
            ),
          ),
        ),
      );
      expect(find.text('Presente'), findsOneWidget);
      expect(find.text('Tardanza'), findsOneWidget);
    });

    testWidgets('el aviso de falta de conexión explica la consecuencia',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: BarraSinConexion())),
      );
      expect(find.textContaining('Sin conexión'), findsOneWidget);
      expect(find.textContaining('No podrás marcar'), findsOneWidget);
    });

    testWidgets('la vista de error muestra el mensaje y permite reintentar',
        (tester) async {
      var reintentos = 0;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: VistaError(
              error: const AppException(
                code: 'SIN_CONEXION',
                message: 'Necesitas conexión a Internet para registrar tu asistencia.',
              ),
              onReintentar: () => reintentos++,
            ),
          ),
        ),
      );

      expect(find.textContaining('conexión a Internet'), findsOneWidget);
      await tester.tap(find.text('Reintentar'));
      expect(reintentos, 1);
    });

    testWidgets('el indicador muestra etiqueta, valor y detalle',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Indicador(
              etiqueta: 'Tardanzas',
              valor: '3',
              detalle: '45 min acumulados',
            ),
          ),
        ),
      );

      expect(find.text('TARDANZAS'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('45 min acumulados'), findsOneWidget);
    });
  });
}
