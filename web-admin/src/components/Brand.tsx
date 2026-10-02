/** Identidad visible de NEXORA para el panel web. */
export function NexoraLockup({
  compact = false,
  light = false,
}: {
  compact?: boolean;
  light?: boolean;
}) {
  return (
    <span className="group inline-flex items-center gap-2" aria-label="NEXORA">
      <img
        src="/marca/nexora-isotipo.png"
        alt=""
        aria-hidden="true"
        className={
          (compact
            ? "h-6 w-6 rounded-md bg-white p-0.5"
            : "h-8 w-8 rounded-lg bg-white p-1") + " nexora-brand-mark"
        }
      />
      <span
        className={
          (compact ? "text-sm" : "text-base") +
          " font-semibold tracking-[0.18em] " +
          (light ? "text-white" : "text-marca-900")
        }
      >
        NEXORA
      </span>
    </span>
  );
}
