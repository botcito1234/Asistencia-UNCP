-- =============================================================================
-- Restricciones de integridad que el lenguaje de esquema de Prisma no expresa.
--
-- El objetivo es que las reglas criticas del negocio esten garantizadas POR LA
-- BASE DE DATOS y no solo por el codigo de la aplicacion. Aunque alguien
-- escribiera directamente con SQL, estas reglas se siguen cumpliendo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. UN SOLO DISPOSITIVO ACTIVO POR USUARIO
-- Indice unico parcial: pueden existir muchas vinculaciones REVOCADAS (la
-- historia se preserva) pero solo una ACTIVA.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_device_binding_activo_por_usuario"
  ON "device_binding" ("user_id")
  WHERE "status" = 'ACTIVO';

-- -----------------------------------------------------------------------------
-- 2. UNA SOLA AUTORIZACION DE CAMBIO VIGENTE POR USUARIO
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_device_auth_vigente_por_usuario"
  ON "device_change_authorization" ("user_id")
  WHERE "consumed_at" IS NULL AND "cancelled_at" IS NULL;

-- -----------------------------------------------------------------------------
-- 3. COORDENADAS Y GEOCERCA VALIDAS
-- -----------------------------------------------------------------------------
ALTER TABLE "site"
  ADD CONSTRAINT "ck_site_latitud"  CHECK ("latitude"  BETWEEN -90  AND 90),
  ADD CONSTRAINT "ck_site_longitud" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "ck_site_radio"    CHECK ("radius_meters" BETWEEN 10 AND 2000);

ALTER TABLE "attendance_mark"
  ADD CONSTRAINT "ck_mark_latitud"   CHECK ("latitude"  BETWEEN -90  AND 90),
  ADD CONSTRAINT "ck_mark_longitud"  CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "ck_mark_precision" CHECK ("accuracy_meters" >= 0),
  ADD CONSTRAINT "ck_mark_distancia" CHECK ("distance_meters" >= 0);

-- -----------------------------------------------------------------------------
-- 4. HORARIOS COHERENTES
-- weekday en formato ISO (1 = lunes ... 7 = domingo).
-- Los minutos se miden desde medianoche: 0..1439.
-- -----------------------------------------------------------------------------
ALTER TABLE "schedule_entry"
  ADD CONSTRAINT "ck_schedule_weekday" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "ck_schedule_inicio"  CHECK ("start_minute" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "ck_schedule_fin"     CHECK ("end_minute" IS NULL OR "end_minute" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "ck_schedule_orden"   CHECK ("end_minute" IS NULL OR "end_minute" > "start_minute"),
  ADD CONSTRAINT "ck_schedule_vigencia" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- -----------------------------------------------------------------------------
-- 5. JORNADA COHERENTE
-- -----------------------------------------------------------------------------
ALTER TABLE "attendance_day"
  ADD CONSTRAINT "ck_day_tardanza" CHECK ("late_minutes" >= 0),
  ADD CONSTRAINT "ck_day_hora_programada"
    CHECK ("scheduled_start_minute" IS NULL OR "scheduled_start_minute" BETWEEN 0 AND 1439),
  -- Si el dia es PUNTUAL, los minutos de tardanza deben ser cero.
  ADD CONSTRAINT "ck_day_puntual_sin_tardanza"
    CHECK ("punctuality" IS DISTINCT FROM 'PUNTUAL' OR "late_minutes" = 0),
  -- Un dia AUSENTE no puede tener clasificacion de puntualidad.
  ADD CONSTRAINT "ck_day_ausente_sin_puntualidad"
    CHECK ("status" <> 'AUSENTE' OR "punctuality" IS NULL);

-- -----------------------------------------------------------------------------
-- 6. NO PUEDE HABER SALIDA SIN ENTRADA
--
-- La restriccion unica (attendance_day_id, type) ya impide dos entradas o dos
-- salidas. Esto cubre la regla restante: una salida exige que exista la entrada
-- de la misma jornada.
--
-- Se implementa como trigger porque una restriccion CHECK no puede consultar
-- otras filas. El bloqueo FOR UPDATE sobre la jornada serializa las
-- marcaciones concurrentes del mismo dia y elimina la condicion de carrera.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_salida_exige_entrada()
RETURNS TRIGGER AS $$
DECLARE
  entrada_existe BOOLEAN;
BEGIN
  IF NEW."type" = 'SALIDA' THEN
    -- Serializa contra otra marcacion simultanea de la misma jornada.
    PERFORM 1 FROM "attendance_day" WHERE "id" = NEW."attendance_day_id" FOR UPDATE;

    SELECT EXISTS (
      SELECT 1 FROM "attendance_mark"
      WHERE "attendance_day_id" = NEW."attendance_day_id"
        AND "type" = 'ENTRADA'
    ) INTO entrada_existe;

    IF NOT entrada_existe THEN
      RAISE EXCEPTION 'SALIDA_SIN_ENTRADA: no existe marcacion de entrada para la jornada %',
        NEW."attendance_day_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_salida_exige_entrada
  BEFORE INSERT ON "attendance_mark"
  FOR EACH ROW
  EXECUTE FUNCTION fn_salida_exige_entrada();

-- -----------------------------------------------------------------------------
-- 7. LA EVIDENCIA DE UNA MARCACION DEBE PERTENECER AL MISMO PRACTICANTE
-- Impide asociar a una marcacion la fotografia de otra persona.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_evidencia_del_mismo_practicante()
RETURNS TRIGGER AS $$
DECLARE
  intern_de_evidencia UUID;
  intern_de_jornada   UUID;
BEGIN
  SELECT "intern_id" INTO intern_de_evidencia FROM "evidence_photo" WHERE "id" = NEW."evidence_id";
  SELECT "intern_id" INTO intern_de_jornada   FROM "attendance_day" WHERE "id" = NEW."attendance_day_id";

  IF intern_de_evidencia IS DISTINCT FROM intern_de_jornada THEN
    RAISE EXCEPTION 'EVIDENCIA_AJENA: la fotografia no pertenece al practicante de la jornada'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evidencia_del_mismo_practicante
  BEFORE INSERT ON "attendance_mark"
  FOR EACH ROW
  EXECUTE FUNCTION fn_evidencia_del_mismo_practicante();

-- -----------------------------------------------------------------------------
-- 8. LA BITACORA DE AUDITORIA NO SE MODIFICA NI SE BORRA
-- Una auditoria que se puede editar no sirve como evidencia.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_auditoria_inmutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AUDITORIA_INMUTABLE: la bitacora de auditoria no admite % ', TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION fn_auditoria_inmutable();

-- Las regularizaciones tampoco se editan: son el registro del cambio.
CREATE TRIGGER trg_regularizacion_inmutable
  BEFORE UPDATE OR DELETE ON "regularization"
  FOR EACH ROW
  EXECUTE FUNCTION fn_auditoria_inmutable();

-- -----------------------------------------------------------------------------
-- 9. INDICES DE APOYO PARA LAS CONSULTAS DEL TABLERO
-- -----------------------------------------------------------------------------
-- Salidas pendientes: consulta muy selectiva sobre pocas filas.
CREATE INDEX "ix_day_pendientes"
  ON "attendance_day" ("site_id", "business_date")
  WHERE "pending_exit" = true;

-- Faltas del periodo.
CREATE INDEX "ix_day_ausentes"
  ON "attendance_day" ("site_id", "business_date")
  WHERE "status" = 'AUSENTE';

-- Eventos de seguridad sin atender: es lo primero que abre el administrador.
CREATE INDEX "ix_evento_pendiente"
  ON "security_event" ("created_at" DESC)
  WHERE "acknowledged_at" IS NULL;

-- Busqueda de practicantes por apellidos y nombres, insensible a mayusculas.
CREATE INDEX "ix_intern_busqueda"
  ON "intern" (LOWER("last_names"), LOWER("first_names"));

-- Evidencias candidatas a archivado.
CREATE INDEX "ix_evidencia_archivables"
  ON "evidence_photo" ("uploaded_at")
  WHERE "released_at" IS NULL;
