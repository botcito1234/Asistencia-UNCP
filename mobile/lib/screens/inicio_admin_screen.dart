import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../core/theme.dart';
import '../models/models.dart';
import '../state/providers.dart';
import '../widgets/comunes.dart';
import 'alertas_admin_screen.dart';
import 'cambiar_password_screen.dart';
import 'notificaciones_screen.dart';
import 'practicantes_admin_screen.dart';

/// Interfaz del administrador en el movil.
///
/// Es una version condensada del panel web: lo que un coordinador necesita
/// resolver desde el telefono (ver como va el dia, atender alertas, desbloquear
/// a alguien). La gestion completa (sedes, reportes, archivado, auditoria) vive
/// en el panel web, que es donde tiene sentido.
class InicioAdminScreen extends ConsumerStatefulWidget {
  const InicioAdminScreen({super.key});

  @override
  ConsumerState<InicioAdminScreen> createState() => _InicioAdminScreenState();
}

class _InicioAdminScreenState extends ConsumerState<InicioAdminScreen> {
  int _pestana = 0;

  @override
  Widget build(BuildContext context) {
    final usuario = ref.watch(usuarioProvider);
    final notificaciones = ref.watch(notificacionesProvider).valueOrNull;
    final sinConexion = ref.watch(hayConexionProvider).valueOrNull == false;

    return Scaffold(
      appBar: AppBar(
        // El escudo va a color sobre una pastilla blanca: la version
        // monocromatica es de contorno fino y a este tamano se emborrona
        // sobre el azul marino de la barra.
        leading: Padding(
          padding: const EdgeInsets.only(left: 12, top: 9, bottom: 9),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Image.asset(
              'assets/marca/uncp-escudo.png',
              semanticLabel: 'Universidad Nacional del Centro del Perú',
            ),
          ),
        ),
        leadingWidth: 62,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Administración',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            Text(
              usuario?.nombre ?? '',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w400,
                color: Color(0xFFCBD5E1),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Notificaciones',
            icon: Badge(
              isLabelVisible: (notificaciones?.sinLeer ?? 0) > 0,
              label: Text('${notificaciones?.sinLeer ?? 0}'),
              child: const Icon(Icons.notifications_outlined),
            ),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const NotificacionesScreen(),
              ),
            ),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (opcion) async {
              if (opcion == 'password') {
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const CambiarPasswordScreen(),
                  ),
                );
              } else if (opcion == 'salir') {
                await ref.read(sesionProvider.notifier).cerrarSesion();
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'password',
                child: ListTile(
                  leading: Icon(Icons.lock_reset_rounded),
                  title: Text('Cambiar contraseña'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuDivider(),
              PopupMenuItem(
                value: 'salir',
                child: ListTile(
                  leading:
                      Icon(Icons.logout_rounded, color: ColoresEstado.peligro),
                  title: Text('Cerrar sesión',
                      style: TextStyle(color: ColoresEstado.peligro)),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          if (sinConexion) const BarraSinConexion(),
          Expanded(
            child: switch (_pestana) {
              0 => const _Tablero(),
              1 => const AlertasAdminScreen(embebido: true),
              _ => const PracticantesAdminScreen(embebido: true),
            },
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _pestana,
        onDestinationSelected: (i) => setState(() => _pestana = i),
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard_rounded),
            label: 'Tablero',
          ),
          NavigationDestination(
            icon: const Icon(Icons.warning_amber_outlined),
            selectedIcon: const Icon(Icons.warning_amber_rounded),
            label: 'Alertas',
          ),
          const NavigationDestination(
            icon: Icon(Icons.people_outline_rounded),
            selectedIcon: Icon(Icons.people_rounded),
            label: 'Practicantes',
          ),
        ],
      ),
    );
  }
}

class _Tablero extends ConsumerWidget {
  const _Tablero();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hoy = DateFormat('yyyy-MM-dd').format(DateTime.now());
    final tablero = ref.watch(tableroProvider(hoy));

    return tablero.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => VistaError(
        error: e,
        onReintentar: () => ref.invalidate(tableroProvider(hoy)),
      ),
      data: (datos) => RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(tableroProvider(hoy));
          await ref.read(tableroProvider(hoy).future);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              _capitalizar(
                DateFormat("EEEE d 'de' MMMM", 'es_PE').format(DateTime.now()),
              ),
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 14),

            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 2.0,
              children: [
                Indicador(
                  etiqueta: 'Practicantes',
                  valor: '${datos.totales.total}',
                  detalle: 'activos',
                ),
                Indicador(
                  etiqueta: 'Presentes',
                  valor: '${datos.totales.presentes}',
                  color: ColoresEstado.exito,
                ),
                Indicador(
                  etiqueta: 'Puntuales',
                  valor: '${datos.totales.puntuales}',
                  color: ColoresEstado.exito,
                ),
                Indicador(
                  etiqueta: 'Tardanzas',
                  valor: '${datos.totales.tardanzas}',
                  color: ColoresEstado.aviso,
                ),
                Indicador(
                  etiqueta: 'Faltas',
                  valor: '${datos.totales.ausentes}',
                  color: ColoresEstado.peligro,
                ),
                Indicador(
                  etiqueta: 'Alertas',
                  valor: '${datos.totales.alertas}',
                  color: datos.totales.alertas > 0
                      ? ColoresEstado.peligro
                      : ColoresEstado.neutro,
                  detalle: 'sin atender',
                ),
                Indicador(
                  etiqueta: 'Todavía dentro',
                  valor: '${datos.totales.todaviaDentro}',
                  color: ColoresEstado.info,
                ),
                Indicador(
                  etiqueta: 'Sal. pendientes',
                  valor: '${datos.totales.salidasPendientes}',
                  color: datos.totales.salidasPendientes > 0
                      ? ColoresEstado.aviso
                      : ColoresEstado.neutro,
                ),
              ],
            ),

            const SizedBox(height: 20),
            const Text(
              'Por sede',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1E293B),
              ),
            ),
            const SizedBox(height: 10),

            if (datos.sedes.isEmpty)
              const EstadoVacio(
                titulo: 'Sin sedes activas',
                descripcion:
                    'Registra sedes desde el panel web para ver su detalle aquí.',
                icono: Icons.business_outlined,
              )
            else
              ...datos.sedes.map((s) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: _FilaSede(sede: s),
                  )),

            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  String _capitalizar(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

class _FilaSede extends StatelessWidget {
  const _FilaSede({required this.sede});
  final TableroSede sede;

  @override
  Widget build(BuildContext context) {
    final t = sede.totales;

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
                    sede.nombre,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ),
                if (t.alertas > 0)
                  Etiqueta(
                    texto: '${t.alertas}',
                    color: ColoresEstado.peligro,
                    icono: Icons.warning_amber_rounded,
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _Mini(etiqueta: 'Total', valor: t.total),
                _Mini(
                  etiqueta: 'Present.',
                  valor: t.presentes,
                  color: ColoresEstado.exito,
                ),
                _Mini(
                  etiqueta: 'Tard.',
                  valor: t.tardanzas,
                  color: ColoresEstado.aviso,
                ),
                _Mini(
                  etiqueta: 'Faltas',
                  valor: t.ausentes,
                  color: ColoresEstado.peligro,
                ),
                _Mini(
                  etiqueta: 'Pend.',
                  valor: t.salidasPendientes,
                  color: ColoresEstado.aviso,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({
    required this.etiqueta,
    required this.valor,
    this.color = ColoresEstado.neutro,
  });

  final String etiqueta;
  final int valor;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            '$valor',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: valor == 0 ? const Color(0xFFCBD5E1) : color,
            ),
          ),
          Text(
            etiqueta,
            style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8)),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
