/**
 * Datos iniciales.
 *
 * Es idempotente: se puede ejecutar varias veces sin duplicar nada.
 *
 * Crea siempre:
 *  - El administrador inicial. Si no se indica SEED_ADMIN_PASSWORD, genera una
 *    contrasena aleatoria y la imprime UNA sola vez.
 *  - Los parametros operativos por defecto.
 *
 * Con SEED_DEMO=true crea ademas sedes y practicantes de ejemplo con horarios,
 * util para probar el panel antes de cargar los datos reales.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, generateTemporaryPassword } from '../src/core/crypto.js';
import { dateOnlyValue } from '../src/core/time.js';

const prisma = new PrismaClient();

const SEDES_DEMO = [
  { code: 'SEDE-01', name: 'Sede Central Lima', address: 'Av. Arequipa 1234, Lima', lat: -12.046374, lng: -77.042793 },
  { code: 'SEDE-02', name: 'Sede Miraflores', address: 'Av. Larco 500, Miraflores', lat: -12.121, lng: -77.0295 },
  { code: 'SEDE-03', name: 'Sede San Juan de Lurigancho', address: 'Av. Proceres 800, SJL', lat: -11.9895, lng: -76.9987 },
];

async function main(): Promise<void> {
  console.log('Preparando datos iniciales...\n');

  // --- Administrador inicial ------------------------------------------------
  const adminDni = process.env.SEED_ADMIN_DNI?.trim() || '00000000';
  const adminName = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador General';
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || null;
  const providedPassword = process.env.SEED_ADMIN_PASSWORD?.trim();

  const existingAdmin = await prisma.userAccount.findUnique({ where: { dni: adminDni } });

  if (existingAdmin) {
    console.log('  El administrador con DNI ' + adminDni + ' ya existe. No se modifica.');
  } else {
    const password = providedPassword || generateTemporaryPassword(14);
    await prisma.userAccount.create({
      data: {
        dni: adminDni,
        passwordHash: await hashPassword(password),
        role: 'ADMINISTRADOR',
        status: 'ACTIVO',
        // Si la contrasena la genero el seed, hay que cambiarla al primer acceso.
        mustChangePassword: !providedPassword,
        displayName: adminName,
        email: adminEmail,
      },
    });

    console.log('  Administrador creado.');
    console.log('  ------------------------------------------------------------');
    console.log('   DNI:        ' + adminDni);
    console.log('   Contraseña: ' + password);
    console.log('  ------------------------------------------------------------');
    if (!providedPassword) {
      console.log('   Esta contraseña NO se vuelve a mostrar. Anótela ahora.');
      console.log('   Se debera cambiar en el primer inicio de sesión.');
    }
    console.log('');
  }

  // --- Parametros operativos ------------------------------------------------
  const settingsExist = await prisma.appSetting.findUnique({ where: { key: 'operacion' } });
  if (!settingsExist) {
    await prisma.appSetting.create({
      data: {
        key: 'operacion',
        value: {
          checkinEarlyWindowMinutes: 15,
          gpsMaxAccuracyMeters: 35,
          gpsMaxAgeSeconds: 60,
          defaultSiteRadiusMeters: 50,
          maxDeviceClockSkewSeconds: 300,
          retentionMonths: 6,
          dayCloseLocalTime: '23:30',
          privacyPolicyVersion: '1.0',
        },
      },
    });
    console.log('  Parámetros operativos inicializados.');
  }

  // --- Datos de demostracion ------------------------------------------------
  if (process.env.SEED_DEMO !== 'true') {
    console.log('\nListo. Para crear sedes y practicantes de ejemplo ejecute con SEED_DEMO=true.');
    return;
  }

  console.log('\nCreando datos de demostracion...');
  const credenciales: { dni: string; nombre: string; sede: string; password: string }[] = [];

  for (const [index, s] of SEDES_DEMO.entries()) {
    const site = await prisma.site.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        name: s.name,
        address: s.address,
        latitude: s.lat,
        longitude: s.lng,
        radiusMeters: 50,
        timezone: 'America/Lima',
      },
      update: {},
    });

    // Dos practicantes por sede, que es la escala real prevista.
    for (let n = 1; n <= 2; n++) {
      const dni = String(40000000 + index * 10 + n);
      const existing = await prisma.userAccount.findUnique({ where: { dni } });
      if (existing) continue;

      const password = generateTemporaryPassword(10);
      const firstNames = ['Ana', 'Luis', 'Maria', 'Carlos', 'Rosa', 'Jorge'][index * 2 + n - 1] ?? 'Practicante';
      const lastNames = ['Quispe Mamani', 'Torres Rojas', 'Flores Diaz', 'Vargas Leon', 'Ramos Castro', 'Silva Paredes'][
        index * 2 + n - 1
      ] ?? 'Apellido';

      const user = await prisma.userAccount.create({
        data: {
          dni,
          passwordHash: await hashPassword(password),
          role: 'PRACTICANTE',
          status: 'ACTIVO',
          mustChangePassword: true,
          displayName: firstNames + ' ' + lastNames,
        },
      });

      const intern = await prisma.intern.create({
        data: {
          userId: user.id,
          dni,
          firstNames,
          lastNames,
          siteId: site.id,
          areaGroup: n === 1 ? 'Aula A' : 'Aula B',
        },
      });

      // Horario distinto por dia, como permite el sistema.
      const horarios: Record<number, number> = {
        1: 8 * 60, // lunes 08:00
        2: 9 * 60, // martes 09:00
        3: 7 * 60 + 30, // miercoles 07:30
        4: 8 * 60,
        5: 8 * 60,
      };

      await prisma.scheduleEntry.createMany({
        data: Object.entries(horarios).map(([weekday, startMinute]) => ({
          internId: intern.id,
          weekday: Number(weekday),
          startMinute,
          endMinute: startMinute + 480,
          effectiveFrom: dateOnlyValue(new Date().toISOString().slice(0, 10)),
        })),
      });

      credenciales.push({ dni, nombre: firstNames + ' ' + lastNames, sede: site.name, password });
    }
  }

  if (credenciales.length > 0) {
    console.log('\n  Practicantes de demostracion creados:');
    console.log('  ------------------------------------------------------------');
    for (const c of credenciales) {
      console.log('   ' + c.dni + '  ' + c.password.padEnd(12) + '  ' + c.nombre + '  (' + c.sede + ')');
    }
    console.log('  ------------------------------------------------------------');
    console.log('   Todas deben cambiarse en el primer inicio de sesión.');
  } else {
    console.log('  Los practicantes de demostracion ya existian.');
  }
}

main()
  .catch((e) => {
    console.error('\nFallo la carga de datos iniciales:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
