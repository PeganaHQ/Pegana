/**
 * Base and share for the Loop impact cascade line.
 *
 * The cascade's `liquidatable_usd` is computed over every collateral position
 * the health-factor bands cover (`collateral_usd`), not only the leveraged
 * subset in the headline (`loop_exposure_usd`). On jitoSOL (2026-10-21) the
 * headline read $21.8M leveraged collateral while the cascade said $60.9M "of
 * leveraged collateral" liquidates: 2.8x more than the headline total. The
 * cascade line now names its real base and shows its share of it.
 *
 * Returns null for the share when the base is missing or smaller than the
 * figure, so an inconsistent payload never prints a share above 100%.
 */
export function cascadeShare(
  liquidatableUsd: number,
  collateralUsd: number,
): number | null {
  if (!Number.isFinite(liquidatableUsd) || !Number.isFinite(collateralUsd)) {
    return null;
  }
  if (collateralUsd <= 0 || liquidatableUsd < 0 || liquidatableUsd > collateralUsd) {
    return null;
  }
  return liquidatableUsd / collateralUsd;
}

/** The API's advisory note, without the em-dash it currently carries. */
export function advisoryNoteText(note: string | null | undefined): string {
  if (!note) return "";
  return note.replace(/\s*\u2014\s*/g, ": ");
}
