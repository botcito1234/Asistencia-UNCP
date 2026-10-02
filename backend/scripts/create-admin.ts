import { prisma } from '../src/infra/db/prisma.js';
import { hashPassword, generateTemporaryPassword } from '../src/core/crypto.js';

const dni = process.env.BOOTSTRAP_ADMIN_DNI?.trim();
const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrador';
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || null;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() || generateTemporaryPassword(12);

if (!dni) throw new Error('Defina BOOTSTRAP_ADMIN_DNI para crear el administrador.');

const passwordHash = await hashPassword(password);
const user = await prisma.userAccount.upsert({
  where: { dni },
  create: { dni, displayName, email, passwordHash, role: 'ADMINISTRADOR', mustChangePassword: true },
  update: { displayName, email, passwordHash, role: 'ADMINISTRADOR', status: 'ACTIVO', mustChangePassword: true },
  select: { id: true, dni: true, displayName: true },
});

console.log(JSON.stringify({ ...user, temporaryPassword: password }, null, 2));
await prisma.$disconnect();
