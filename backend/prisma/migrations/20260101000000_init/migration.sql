-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMINISTRADOR', 'PRACTICANTE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "DeviceBindingStatus" AS ENUM ('ACTIVO', 'REVOCADO');

-- CreateEnum
CREATE TYPE "MarkType" AS ENUM ('ENTRADA', 'SALIDA');

-- CreateEnum
CREATE TYPE "Punctuality" AS ENUM ('PUNTUAL', 'TARDANZA');

-- CreateEnum
CREATE TYPE "AttendanceDayStatus" AS ENUM ('PROGRAMADO', 'PRESENTE', 'AUSENTE', 'NO_LABORABLE');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('MARCACION_ENTRADA', 'MARCACION_SALIDA', 'PERFIL');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('ACTIVA', 'ARCHIVADA', 'LIBERADA');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('FUERA_DE_GEOCERCA', 'UBICACION_SIMULADA', 'GPS_IMPRECISO', 'DISPOSITIVO_NO_AUTORIZADO', 'SESION_SIMULTANEA', 'ENTRADA_DUPLICADA', 'SALIDA_DUPLICADA', 'SALIDA_SIN_ENTRADA', 'MARCACION_FUERA_DE_VENTANA', 'CREDENCIALES_INVALIDAS', 'CUENTA_BLOQUEADA', 'EVIDENCIA_INVALIDA', 'INTENTO_SOSPECHOSO', 'SALIDA_PENDIENTE', 'FALTA_REGISTRADA', 'ARCHIVADO_FALLIDO');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'ADVERTENCIA', 'CRITICO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ENTRADA_REGISTRADA', 'TARDANZA_REGISTRADA', 'SALIDA_REGISTRADA', 'FALTA_REGISTRADA', 'SALIDA_PENDIENTE', 'FUERA_DE_GEOCERCA', 'UBICACION_SIMULADA', 'DISPOSITIVO_NO_AUTORIZADO', 'EVENTO_CRITICO', 'REGULARIZACION', 'ARCHIVADO');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'OMITIDO');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('PENDIENTE', 'GENERANDO', 'SUBIENDO', 'VERIFICANDO', 'COMPLETADO', 'LIBERADO', 'FALLIDO');

-- CreateEnum
CREATE TYPE "RegularizationField" AS ENUM ('ENTRADA_HORA', 'SALIDA_HORA', 'PUNTUALIDAD', 'ESTADO_DIA', 'JUSTIFICACION');

-- CreateTable
CREATE TABLE "user_account" (
    "id" UUID NOT NULL,
    "dni" VARCHAR(15) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVO',
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "display_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(160),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_set_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(128) NOT NULL,
    "device_fingerprint" VARCHAR(128),
    "user_agent" VARCHAR(255),
    "ip_address" VARCHAR(64),
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(120),
    "replaced_by_id" UUID,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "push_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_binding" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_fingerprint" VARCHAR(128) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "model" VARCHAR(120),
    "os_version" VARCHAR(60),
    "app_version" VARCHAR(40),
    "status" "DeviceBindingStatus" NOT NULL DEFAULT 'ACTIVO',
    "bound_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoke_reason" VARCHAR(255),

    CONSTRAINT "device_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_change_authorization" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "device_change_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 50,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'America/Lima',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intern" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "dni" VARCHAR(15) NOT NULL,
    "first_names" VARCHAR(120) NOT NULL,
    "last_names" VARCHAR(120) NOT NULL,
    "area_group" VARCHAR(120),
    "phone" VARCHAR(30),
    "email" VARCHAR(160),
    "site_id" UUID NOT NULL,
    "profile_photo_id" UUID,
    "consent_accepted_at" TIMESTAMPTZ(6),
    "consent_policy_version" VARCHAR(20),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "intern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_entry" (
    "id" UUID NOT NULL,
    "intern_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "schedule_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_day" (
    "id" UUID NOT NULL,
    "intern_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "scheduled_start_minute" INTEGER,
    "scheduled_end_minute" INTEGER,
    "schedule_entry_id" UUID,
    "status" "AttendanceDayStatus" NOT NULL DEFAULT 'PROGRAMADO',
    "punctuality" "Punctuality",
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "pending_exit" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMPTZ(6),
    "regularized" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_mark" (
    "id" UUID NOT NULL,
    "attendance_day_id" UUID NOT NULL,
    "type" "MarkType" NOT NULL,
    "server_time" TIMESTAMPTZ(6) NOT NULL,
    "device_time" TIMESTAMPTZ(6),
    "device_clock_skew_seconds" INTEGER,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "accuracy_meters" DECIMAL(7,2) NOT NULL,
    "distance_meters" DECIMAL(9,2) NOT NULL,
    "altitude" DECIMAL(9,2),
    "speed" DECIMAL(7,2),
    "location_age_ms" INTEGER,
    "mock_location_reported" BOOLEAN NOT NULL DEFAULT false,
    "developer_mode_reported" BOOLEAN NOT NULL DEFAULT false,
    "evidence_id" UUID NOT NULL,
    "device_binding_id" UUID,
    "ip_address" VARCHAR(64),
    "idempotency_key" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regularization" (
    "id" UUID NOT NULL,
    "attendance_day_id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "field" "RegularizationField" NOT NULL,
    "old_value" VARCHAR(255),
    "new_value" VARCHAR(255),
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regularization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_photo" (
    "id" UUID NOT NULL,
    "intern_id" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'ACTIVA',
    "storage_key" VARCHAR(400) NOT NULL,
    "mime_type" VARCHAR(60) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" VARCHAR(64) NOT NULL,
    "captured_at" TIMESTAMPTZ(6),
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capture_source" VARCHAR(20) NOT NULL DEFAULT 'CAMARA',
    "face_embedding" BYTEA,
    "face_embedding_model" VARCHAR(60),
    "archived_at" TIMESTAMPTZ(6),
    "drive_file_id" VARCHAR(120),
    "released_at" TIMESTAMPTZ(6),
    "archive_batch_id" UUID,

    CONSTRAINT "evidence_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_event" (
    "id" UUID NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'ADVERTENCIA',
    "intern_id" UUID,
    "user_id" UUID,
    "site_id" UUID,
    "message" VARCHAR(400) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "accuracy_meters" DECIMAL(7,2),
    "distance_meters" DECIMAL(9,2),
    "device_fingerprint" VARCHAR(128),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "details" JSONB,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by" UUID,
    "acknowledge_note" VARCHAR(400),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'INFO',
    "recipient_user_id" UUID,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(600) NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDIENTE',
    "target" VARCHAR(255),
    "error" VARCHAR(400),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "UserRole",
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(80),
    "before" JSONB,
    "after" JSONB,
    "reason" VARCHAR(500),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_batch" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'PENDIENTE',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "attendance_days" INTEGER NOT NULL DEFAULT 0,
    "marks_count" INTEGER NOT NULL DEFAULT 0,
    "photos_count" INTEGER NOT NULL DEFAULT 0,
    "events_count" INTEGER NOT NULL DEFAULT 0,
    "package_bytes" INTEGER,
    "package_sha256" VARCHAR(64),
    "drive_folder_id" VARCHAR(120),
    "drive_file_id" VARCHAR(120),
    "drive_web_link" VARCHAR(400),
    "drive_checksum" VARCHAR(64),
    "started_at" TIMESTAMPTZ(6),
    "uploaded_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(600),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "archive_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "job_run" (
    "id" UUID NOT NULL,
    "job_name" VARCHAR(80) NOT NULL,
    "run_key" VARCHAR(120) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "success" BOOLEAN,
    "summary" JSONB,
    "error" VARCHAR(600),

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_account_dni_key" ON "user_account"("dni");

-- CreateIndex
CREATE INDEX "user_account_role_status_idx" ON "user_account"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "session_refresh_token_hash_key" ON "session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_revoked_at_idx" ON "session"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_token_token_key" ON "push_token"("token");

-- CreateIndex
CREATE INDEX "push_token_user_id_revoked_at_idx" ON "push_token"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "device_binding_user_id_status_idx" ON "device_binding"("user_id", "status");

-- CreateIndex
CREATE INDEX "device_binding_device_fingerprint_idx" ON "device_binding"("device_fingerprint");

-- CreateIndex
CREATE INDEX "device_change_authorization_user_id_consumed_at_idx" ON "device_change_authorization"("user_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_code_key" ON "site"("code");

-- CreateIndex
CREATE INDEX "site_active_idx" ON "site"("active");

-- CreateIndex
CREATE UNIQUE INDEX "intern_user_id_key" ON "intern"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "intern_dni_key" ON "intern"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "intern_profile_photo_id_key" ON "intern"("profile_photo_id");

-- CreateIndex
CREATE INDEX "intern_site_id_active_idx" ON "intern"("site_id", "active");

-- CreateIndex
CREATE INDEX "intern_last_names_first_names_idx" ON "intern"("last_names", "first_names");

-- CreateIndex
CREATE INDEX "schedule_entry_intern_id_weekday_effective_from_idx" ON "schedule_entry"("intern_id", "weekday", "effective_from");

-- CreateIndex
CREATE INDEX "attendance_day_business_date_site_id_idx" ON "attendance_day"("business_date", "site_id");

-- CreateIndex
CREATE INDEX "attendance_day_site_id_status_business_date_idx" ON "attendance_day"("site_id", "status", "business_date");

-- CreateIndex
CREATE INDEX "attendance_day_pending_exit_business_date_idx" ON "attendance_day"("pending_exit", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_day_intern_id_business_date_key" ON "attendance_day"("intern_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_mark_evidence_id_key" ON "attendance_mark"("evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_mark_idempotency_key_key" ON "attendance_mark"("idempotency_key");

-- CreateIndex
CREATE INDEX "attendance_mark_server_time_idx" ON "attendance_mark"("server_time");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_mark_attendance_day_id_type_key" ON "attendance_mark"("attendance_day_id", "type");

-- CreateIndex
CREATE INDEX "regularization_attendance_day_id_idx" ON "regularization"("attendance_day_id");

-- CreateIndex
CREATE INDEX "regularization_admin_user_id_created_at_idx" ON "regularization"("admin_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_photo_storage_key_key" ON "evidence_photo"("storage_key");

-- CreateIndex
CREATE INDEX "evidence_photo_intern_id_kind_uploaded_at_idx" ON "evidence_photo"("intern_id", "kind", "uploaded_at");

-- CreateIndex
CREATE INDEX "evidence_photo_status_uploaded_at_idx" ON "evidence_photo"("status", "uploaded_at");

-- CreateIndex
CREATE INDEX "security_event_created_at_idx" ON "security_event"("created_at");

-- CreateIndex
CREATE INDEX "security_event_type_created_at_idx" ON "security_event"("type", "created_at");

-- CreateIndex
CREATE INDEX "security_event_site_id_created_at_idx" ON "security_event"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "security_event_acknowledged_at_severity_idx" ON "security_event"("acknowledged_at", "severity");

-- CreateIndex
CREATE INDEX "notification_recipient_user_id_read_at_created_at_idx" ON "notification"("recipient_user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_created_at_idx" ON "notification"("created_at");

-- CreateIndex
CREATE INDEX "notification_delivery_status_channel_idx" ON "notification_delivery"("status", "channel");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_created_at_idx" ON "audit_log"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "archive_batch_status_idx" ON "archive_batch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "archive_batch_site_id_year_month_key" ON "archive_batch"("site_id", "year", "month");

-- CreateIndex
CREATE INDEX "job_run_job_name_started_at_idx" ON "job_run"("job_name", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_run_job_name_run_key_key" ON "job_run"("job_name", "run_key");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_binding" ADD CONSTRAINT "device_binding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_binding" ADD CONSTRAINT "device_binding_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intern" ADD CONSTRAINT "intern_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intern" ADD CONSTRAINT "intern_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intern" ADD CONSTRAINT "intern_profile_photo_id_fkey" FOREIGN KEY ("profile_photo_id") REFERENCES "evidence_photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_mark" ADD CONSTRAINT "attendance_mark_attendance_day_id_fkey" FOREIGN KEY ("attendance_day_id") REFERENCES "attendance_day"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_mark" ADD CONSTRAINT "attendance_mark_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence_photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_mark" ADD CONSTRAINT "attendance_mark_device_binding_id_fkey" FOREIGN KEY ("device_binding_id") REFERENCES "device_binding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regularization" ADD CONSTRAINT "regularization_attendance_day_id_fkey" FOREIGN KEY ("attendance_day_id") REFERENCES "attendance_day"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regularization" ADD CONSTRAINT "regularization_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_photo" ADD CONSTRAINT "evidence_photo_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_photo" ADD CONSTRAINT "evidence_photo_archive_batch_id_fkey" FOREIGN KEY ("archive_batch_id") REFERENCES "archive_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "intern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_batch" ADD CONSTRAINT "archive_batch_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

