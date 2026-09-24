/// Modelos de datos que viajan entre la aplicacion y el servidor.
///
/// Se escriben a mano y no con generacion de codigo: el contrato es pequeno,
/// estable y asi no hace falta ejecutar build_runner para compilar el APK.
library;

class Usuario {
  const Usuario({
    required this.id,
    required this.dni,
    required this.rol,
    required this.nombre,
    required this.debeCambiarPassword,
    this.practicante,
  });

  final String id;
  final String dni;
  final String rol;
  final String nombre;
  final bool debeCambiarPassword;
  final Practicante? practicante;

  bool get esAdministrador => rol == 'ADMINISTRADOR';
  bool get esPracticante => rol == 'PRACTICANTE';

  factory Usuario.desdeJson(Map<String, dynamic> json) => Usuario(
        id: json['id'] as String,
        dni: json['dni'] as String,
        rol: json['role'] as String,
        nombre: json['displayName'] as String,
        debeCambiarPassword: json['mustChangePassword'] as bool? ?? false,
        practicante: json['intern'] == null
            ? null
            : Practicante.desdeJson(json['intern'] as Map<String, dynamic>),
      );

  Map<String, dynamic> aJson() => {
        'id': id,
        'dni': dni,
        'role': rol,
        'displayName': nombre,
        'mustChangePassword': debeCambiarPassword,
        'intern': practicante?.aJson(),
      };
}

class Practicante {
  const Practicante({
    required this.id,
    required this.nombres,
    required this.apellidos,
    required this.sede,
    required this.consentimientoAceptado,
    this.areaGrupo,
  });

  final String id;
  final String nombres;
  final String apellidos;
  final String? areaGrupo;
  final Sede sede;
  final bool consentimientoAceptado;

  String get nombreCompleto => '$nombres $apellidos';

  factory Practicante.desdeJson(Map<String, dynamic> json) => Practicante(
        id: json['id'] as String,
        nombres: json['firstNames'] as String,
        apellidos: json['lastNames'] as String,
        areaGrupo: json['areaGroup'] as String?,
        sede: Sede.desdeJson(json['site'] as Map<String, dynamic>),
        consentimientoAceptado: json['consentAccepted'] as bool? ?? false,
      );

  Map<String, dynamic> aJson() => {
        'id': id,
        'firstNames': nombres,
        'lastNames': apellidos,
        'areaGroup': areaGrupo,
        'site': sede.aJson(),
        'consentAccepted': consentimientoAceptado,
      };
}

class Sede {
  const Sede({
    required this.id,
    required this.codigo,
    required this.nombre,
    required this.latitud,
    required this.longitud,
    required this.radioMetros,
    required this.zonaHoraria,
  });

  final String id;
  final String codigo;
  final String nombre;
  final double latitud;
  final double longitud;
  final int radioMetros;
  final String zonaHoraria;

  factory Sede.desdeJson(Map<String, dynamic> json) => Sede(
        id: json['id'] as String,
        codigo: json['code'] as String? ?? '',
        nombre: json['name'] as String,
        latitud: (json['latitude'] as num).toDouble(),
        longitud: (json['longitude'] as num).toDouble(),
        radioMetros: (json['radiusMeters'] as num).toInt(),
        zonaHoraria: json['timezone'] as String? ?? 'America/Lima',
      );

  Map<String, dynamic> aJson() => {
        'id': id,
        'code': codigo,
        'name': nombre,
        'latitude': latitud,
        'longitude': longitud,
        'radiusMeters': radioMetros,
        'timezone': zonaHoraria,
      };
}

/// Estado de la jornada de hoy, tal y como lo calcula el servidor.
/// La aplicacion no decide si se puede marcar: lo pregunta.
class EstadoHoy {
  const EstadoHoy({
    required this.fechaNegocio,
    required this.horaServidor,
    required this.horaLocal,
    required this.sede,
    required this.horaEntradaProgramada,
    required this.horaSalidaProgramada,
    required this.tieneHorario,
    required this.estado,
    required this.puntualidad,
    required this.minutosTardanza,
    required this.salidaPendiente,
    required this.puedeMarcarEntrada,
    required this.puedeMarcarSalida,
    required this.abreA,
    required this.motivo,
    required this.precisionMaximaMetros,
    required this.antiguedadMaximaSegundos,
    this.entrada,
    this.salida,
  });

  final String fechaNegocio;
  final String horaServidor;
  final String horaLocal;
  final Sede sede;
  final String? horaEntradaProgramada;
  final String? horaSalidaProgramada;
  final bool tieneHorario;
  final String estado;
  final String? puntualidad;
  final int minutosTardanza;
  final bool salidaPendiente;
  final bool puedeMarcarEntrada;
  final bool puedeMarcarSalida;
  final String? abreA;
  final String? motivo;
  final double precisionMaximaMetros;
  final int antiguedadMaximaSegundos;
  final Marcacion? entrada;
  final Marcacion? salida;

  factory EstadoHoy.desdeJson(Map<String, dynamic> json) {
    final acciones = json['actions'] as Map<String, dynamic>;
    final horario = json['schedule'] as Map<String, dynamic>;
    final gps = json['gpsRequirements'] as Map<String, dynamic>;

    return EstadoHoy(
      fechaNegocio: json['businessDate'] as String,
      horaServidor: json['serverTime'] as String,
      horaLocal: json['localTime'] as String,
      sede: Sede.desdeJson(json['site'] as Map<String, dynamic>),
      horaEntradaProgramada: horario['startTime'] as String?,
      horaSalidaProgramada: horario['endTime'] as String?,
      tieneHorario: horario['hasSchedule'] as bool? ?? false,
      estado: json['status'] as String,
      puntualidad: json['punctuality'] as String?,
      minutosTardanza: (json['lateMinutes'] as num?)?.toInt() ?? 0,
      salidaPendiente: json['pendingExit'] as bool? ?? false,
      puedeMarcarEntrada: acciones['canCheckIn'] as bool? ?? false,
      puedeMarcarSalida: acciones['canCheckOut'] as bool? ?? false,
      abreA: acciones['checkInOpensAt'] as String?,
      motivo: acciones['reason'] as String?,
      precisionMaximaMetros:
          (gps['maxAccuracyMeters'] as num?)?.toDouble() ?? 35,
      antiguedadMaximaSegundos: (gps['maxAgeSeconds'] as num?)?.toInt() ?? 60,
      entrada: json['checkIn'] == null
          ? null
          : Marcacion.desdeJson(json['checkIn'] as Map<String, dynamic>),
      salida: json['checkOut'] == null
          ? null
          : Marcacion.desdeJson(json['checkOut'] as Map<String, dynamic>),
    );
  }
}

class Marcacion {
  const Marcacion({
    required this.id,
    required this.hora,
    required this.horaLocal,
    required this.distanciaMetros,
    required this.precisionMetros,
    required this.latitud,
    required this.longitud,
    required this.evidenciaId,
  });

  final String id;
  final String hora;
  final String horaLocal;
  final double distanciaMetros;
  final double precisionMetros;
  final double latitud;
  final double longitud;
  final String evidenciaId;

  factory Marcacion.desdeJson(Map<String, dynamic> json) => Marcacion(
        id: json['id'] as String,
        hora: json['time'] as String,
        horaLocal: json['localTime'] as String,
        distanciaMetros: (json['distanceMeters'] as num).toDouble(),
        precisionMetros: (json['accuracyMeters'] as num).toDouble(),
        latitud: (json['latitude'] as num).toDouble(),
        longitud: (json['longitude'] as num).toDouble(),
        evidenciaId: json['evidenceId'] as String,
      );
}

/// Resultado de una marcacion aceptada.
class ResultadoMarcacion {
  const ResultadoMarcacion({
    required this.tipo,
    required this.fechaNegocio,
    required this.horaLocal,
    required this.puntualidad,
    required this.minutosTardanza,
    required this.distanciaMetros,
    required this.precisionMetros,
    required this.duplicada,
    this.horaProgramada,
  });

  final String tipo;
  final String fechaNegocio;
  final String horaLocal;
  final String? puntualidad;
  final int minutosTardanza;
  final double distanciaMetros;
  final double precisionMetros;
  final bool duplicada;
  final String? horaProgramada;

  bool get esEntrada => tipo == 'ENTRADA';
  bool get esTardanza => puntualidad == 'TARDANZA';

  factory ResultadoMarcacion.desdeJson(Map<String, dynamic> json) =>
      ResultadoMarcacion(
        tipo: json['type'] as String,
        fechaNegocio: json['businessDate'] as String,
        horaLocal: json['localTime'] as String? ?? '',
        puntualidad: json['punctuality'] as String?,
        minutosTardanza: (json['lateMinutes'] as num?)?.toInt() ?? 0,
        distanciaMetros: (json['distanceMeters'] as num?)?.toDouble() ?? 0,
        precisionMetros: (json['accuracyMeters'] as num?)?.toDouble() ?? 0,
        duplicada: json['deduplicated'] as bool? ?? false,
        horaProgramada: json['scheduledStartTime'] as String?,
      );
}

/// Una jornada del historial.
class Jornada {
  const Jornada({
    required this.id,
    required this.fecha,
    required this.estado,
    required this.minutosTardanza,
    required this.salidaPendiente,
    required this.regularizada,
    this.horaProgramada,
    this.puntualidad,
    this.horaEntrada,
    this.horaSalida,
    this.minutosTrabajados,
  });

  final String id;
  final String fecha;
  final String? horaProgramada;
  final String estado;
  final String? puntualidad;
  final int minutosTardanza;
  final bool salidaPendiente;
  final bool regularizada;
  final String? horaEntrada;
  final String? horaSalida;
  final int? minutosTrabajados;

  factory Jornada.desdeJson(Map<String, dynamic> json) {
    final entrada = json['checkIn'] as Map<String, dynamic>?;
    final salida = json['checkOut'] as Map<String, dynamic>?;
    return Jornada(
      id: json['id'] as String,
      fecha: json['businessDate'] as String,
      horaProgramada: json['scheduledStartTime'] as String?,
      estado: json['status'] as String,
      puntualidad: json['punctuality'] as String?,
      minutosTardanza: (json['lateMinutes'] as num?)?.toInt() ?? 0,
      salidaPendiente: json['pendingExit'] as bool? ?? false,
      regularizada: json['regularized'] as bool? ?? false,
      horaEntrada: entrada?['localTime'] as String?,
      horaSalida: salida?['localTime'] as String?,
      minutosTrabajados: (json['workedMinutes'] as num?)?.toInt(),
    );
  }
}

class ResumenPeriodo {
  const ResumenPeriodo({
    required this.jornadasProgramadas,
    required this.presentes,
    required this.puntuales,
    required this.tardanzas,
    required this.ausentes,
    required this.salidasPendientes,
    required this.minutosTardanzaTotal,
    this.porcentajePuntualidad,
  });

  final int jornadasProgramadas;
  final int presentes;
  final int puntuales;
  final int tardanzas;
  final int ausentes;
  final int salidasPendientes;
  final int minutosTardanzaTotal;
  final double? porcentajePuntualidad;

  factory ResumenPeriodo.desdeJson(Map<String, dynamic> json) => ResumenPeriodo(
        jornadasProgramadas: (json['jornadasProgramadas'] as num?)?.toInt() ?? 0,
        presentes: (json['presentes'] as num?)?.toInt() ?? 0,
        puntuales: (json['puntuales'] as num?)?.toInt() ?? 0,
        tardanzas: (json['tardanzas'] as num?)?.toInt() ?? 0,
        ausentes: (json['ausentes'] as num?)?.toInt() ?? 0,
        salidasPendientes: (json['salidasPendientes'] as num?)?.toInt() ?? 0,
        minutosTardanzaTotal:
            (json['minutosTardanzaTotal'] as num?)?.toInt() ?? 0,
        porcentajePuntualidad:
            (json['porcentajePuntualidad'] as num?)?.toDouble(),
      );
}

class Notificacion {
  const Notificacion({
    required this.id,
    required this.tipo,
    required this.severidad,
    required this.titulo,
    required this.cuerpo,
    required this.creadaEn,
    this.leidaEn,
  });

  final String id;
  final String tipo;
  final String severidad;
  final String titulo;
  final String cuerpo;
  final String creadaEn;
  final String? leidaEn;

  bool get leida => leidaEn != null;

  factory Notificacion.desdeJson(Map<String, dynamic> json) => Notificacion(
        id: json['id'] as String,
        tipo: json['type'] as String,
        severidad: json['severity'] as String,
        titulo: json['title'] as String,
        cuerpo: json['body'] as String,
        creadaEn: json['createdAt'] as String,
        leidaEn: json['readAt'] as String?,
      );
}

/// Indicadores del tablero, para la vista de administrador en el movil.
class TableroTotales {
  const TableroTotales({
    required this.total,
    required this.presentes,
    required this.puntuales,
    required this.tardanzas,
    required this.ausentes,
    required this.salidas,
    required this.todaviaDentro,
    required this.salidasPendientes,
    required this.alertas,
  });

  final int total;
  final int presentes;
  final int puntuales;
  final int tardanzas;
  final int ausentes;
  final int salidas;
  final int todaviaDentro;
  final int salidasPendientes;
  final int alertas;

  factory TableroTotales.desdeJson(Map<String, dynamic> json) =>
      TableroTotales(
        total: (json['total'] as num?)?.toInt() ?? 0,
        presentes: (json['presentes'] as num?)?.toInt() ?? 0,
        puntuales: (json['puntuales'] as num?)?.toInt() ?? 0,
        tardanzas: (json['tardanzas'] as num?)?.toInt() ?? 0,
        ausentes: (json['ausentes'] as num?)?.toInt() ?? 0,
        salidas: (json['salidas'] as num?)?.toInt() ?? 0,
        todaviaDentro: (json['todaviaDentro'] as num?)?.toInt() ?? 0,
        salidasPendientes: (json['salidasPendientes'] as num?)?.toInt() ?? 0,
        alertas: (json['alertas'] as num?)?.toInt() ?? 0,
      );
}

class TableroSede {
  const TableroSede({
    required this.sedeId,
    required this.nombre,
    required this.totales,
  });

  final String sedeId;
  final String nombre;
  final TableroTotales totales;

  factory TableroSede.desdeJson(Map<String, dynamic> json) => TableroSede(
        sedeId: json['siteId'] as String,
        nombre: json['siteName'] as String,
        totales: TableroTotales.desdeJson(json),
      );
}

class EventoSeguridad {
  const EventoSeguridad({
    required this.id,
    required this.tipo,
    required this.severidad,
    required this.mensaje,
    required this.creadoEn,
    required this.atendido,
    this.practicante,
    this.sede,
  });

  final String id;
  final String tipo;
  final String severidad;
  final String mensaje;
  final String creadoEn;
  final bool atendido;
  final String? practicante;
  final String? sede;

  factory EventoSeguridad.desdeJson(Map<String, dynamic> json) {
    final interno = json['intern'] as Map<String, dynamic>?;
    final sede = json['site'] as Map<String, dynamic>?;
    return EventoSeguridad(
      id: json['id'] as String,
      tipo: json['type'] as String,
      severidad: json['severity'] as String,
      mensaje: json['message'] as String,
      creadoEn: json['createdAt'] as String,
      atendido: json['acknowledgedAt'] != null,
      practicante: interno == null
          ? null
          : '${interno['lastNames']}, ${interno['firstNames']}',
      sede: sede?['name'] as String?,
    );
  }
}
