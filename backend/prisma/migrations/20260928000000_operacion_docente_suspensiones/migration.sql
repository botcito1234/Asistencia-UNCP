-- Tercer rol, sesiones de practica, suspensiones y seguimiento docente.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DOCENTE_CONDUCTOR';
ALTER TYPE "AttendanceDayStatus" ADD VALUE IF NOT EXISTS 'SUSPENDIDA';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REPORTE_DOCENTE';

CREATE TYPE "SuspensionScope" AS ENUM ('SITE', 'INTERN', 'SELECTED_INTERNS');
CREATE TYPE "TeacherReportCategory" AS ENUM (
  'DOMINIO_DISCIPLINAR', 'PLANIFICACION', 'MANEJO_DE_AULA', 'METODOLOGIA',
  'PUNTUALIDAD', 'RESPONSABILIDAD', 'COMUNICACION', 'OTROS'
);
CREATE TYPE "TeacherReportNature" AS ENUM ('POSITIVA', 'OBSERVACION_DE_MEJORA', 'INCIDENCIA');
CREATE TYPE "TeacherReportImportance" AS ENUM ('BAJO', 'MEDIO', 'ALTO');

ALTER TABLE "attendance_day" ADD COLUMN "session_name" VARCHAR(160) NOT NULL DEFAULT 'Jornada';
ALTER TABLE "attendance_day" ADD COLUMN "observation" VARCHAR(500);
ALTER TABLE "attendance_day" ADD COLUMN "suspension_id" UUID;

CREATE TABLE "conductor_profile" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "phone" VARCHAR(30),
  "email" VARCHAR(160),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "conductor_profile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conductor_profile_user_id_key" ON "conductor_profile"("user_id");
ALTER TABLE "conductor_profile" ADD CONSTRAINT "conductor_profile_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "intern_conductor" (
  "id" UUID NOT NULL,
  "intern_id" UUID NOT NULL,
  "conductor_id" UUID NOT NULL,
  "assigned_by" UUID,
  "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "intern_conductor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "intern_conductor_intern_id_conductor_id_key" ON "intern_conductor"("intern_id", "conductor_id");
CREATE INDEX "intern_conductor_conductor_id_revoked_at_idx" ON "intern_conductor"("conductor_id", "revoked_at");
CREATE INDEX "intern_conductor_intern_id_revoked_at_idx" ON "intern_conductor"("intern_id", "revoked_at");
ALTER TABLE "intern_conductor" ADD CONSTRAINT "intern_conductor_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intern_conductor" ADD CONSTRAINT "intern_conductor_conductor_id_fkey"
  FOREIGN KEY ("conductor_id") REFERENCES "conductor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "suspension" (
  "id" UUID NOT NULL,
  "business_date" DATE NOT NULL,
  "scope" "SuspensionScope" NOT NULL,
  "site_id" UUID,
  "intern_id" UUID,
  "reason" VARCHAR(300) NOT NULL,
  "observation" VARCHAR(500),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suspension_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "suspension_business_date_scope_idx" ON "suspension"("business_date", "scope");
CREATE INDEX "suspension_site_id_business_date_idx" ON "suspension"("site_id", "business_date");
CREATE INDEX "suspension_intern_id_business_date_idx" ON "suspension"("intern_id", "business_date");
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "suspension_intern" (
  "suspension_id" UUID NOT NULL,
  "intern_id" UUID NOT NULL,
  CONSTRAINT "suspension_intern_pkey" PRIMARY KEY ("suspension_id", "intern_id")
);
ALTER TABLE "suspension_intern" ADD CONSTRAINT "suspension_intern_suspension_id_fkey"
  FOREIGN KEY ("suspension_id") REFERENCES "suspension"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suspension_intern" ADD CONSTRAINT "suspension_intern_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "teacher_report" (
  "id" UUID NOT NULL,
  "conductor_id" UUID NOT NULL,
  "intern_id" UUID NOT NULL,
  "category" "TeacherReportCategory" NOT NULL,
  "nature" "TeacherReportNature" NOT NULL,
  "importance" "TeacherReportImportance" NOT NULL,
  "detail" VARCHAR(2000) NOT NULL,
  "recommendation" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "teacher_report_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "teacher_report_conductor_id_created_at_idx" ON "teacher_report"("conductor_id", "created_at");
CREATE INDEX "teacher_report_intern_id_created_at_idx" ON "teacher_report"("intern_id", "created_at");
CREATE INDEX "teacher_report_importance_nature_created_at_idx" ON "teacher_report"("importance", "nature", "created_at");
ALTER TABLE "teacher_report" ADD CONSTRAINT "teacher_report_conductor_id_fkey"
  FOREIGN KEY ("conductor_id") REFERENCES "conductor_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teacher_report" ADD CONSTRAINT "teacher_report_intern_id_fkey"
  FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_suspension_id_fkey"
  FOREIGN KEY ("suspension_id") REFERENCES "suspension"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "attendance_day_suspension_id_idx" ON "attendance_day"("suspension_id");

-- Evita borrado fisico accidental del historial al eliminar una cuenta de
-- practicante; la API ya trabaja con desactivacion logica.
ALTER TABLE "intern" DROP CONSTRAINT IF EXISTS "intern_user_id_fkey";
ALTER TABLE "intern" ADD CONSTRAINT "intern_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
