-- Copia remota de cada fotografia de evidencia.
--
-- Con EVIDENCE_REMOTE_STORAGE la fotografia vive en Google Drive y el disco del
-- servidor pasa a ser un paso intermedio. Eso permite hospedar la API sin
-- volumen persistente, pero exige poder responder en todo momento estas dos
-- preguntas: donde esta la copia remota y si coincide con la local.
--
-- La copia local se borra UNICAMENTE cuando Drive confirma el mismo MD5. Hasta
-- ese momento la unica copia valida es la del disco, y por eso `local_released_at`
-- solo puede estar puesto si `remote_at` tambien lo esta (ver la restriccion).

ALTER TABLE "evidence_photo"
  ADD COLUMN "remote_file_id"      VARCHAR(120),
  ADD COLUMN "remote_md5"          VARCHAR(32),
  ADD COLUMN "remote_at"           TIMESTAMPTZ(6),
  ADD COLUMN "remote_attempts"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "remote_error"        VARCHAR(300),
  ADD COLUMN "local_released_at"   TIMESTAMPTZ(6);

-- No se puede declarar que se borro la copia local sin una copia remota
-- verificada. Es la misma regla que ya rige el archivado mensual, aplicada a
-- cada fotografia.
ALTER TABLE "evidence_photo"
  ADD CONSTRAINT "evidencia_local_liberada_exige_remota"
  CHECK ("local_released_at" IS NULL OR ("remote_at" IS NOT NULL AND "remote_file_id" IS NOT NULL));

-- Una fotografia verificada tiene que tener su huella remota.
ALTER TABLE "evidence_photo"
  ADD CONSTRAINT "evidencia_remota_con_huella"
  CHECK ("remote_at" IS NULL OR ("remote_file_id" IS NOT NULL AND "remote_md5" IS NOT NULL));

CREATE INDEX "evidence_photo_remote_at_uploaded_at_idx"
  ON "evidence_photo"("remote_at", "uploaded_at");

-- Cola de subida: solo las que aun no tienen copia remota. El indice parcial
-- mantiene barata la consulta aunque la tabla crezca.
CREATE INDEX "evidence_photo_pendientes_de_subir_idx"
  ON "evidence_photo"("uploaded_at")
  WHERE "remote_at" IS NULL AND "status" = 'ACTIVA';
