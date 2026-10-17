import { inCalibrationWindow } from "@/lib/calibration";
import { CalibrationBannerClient } from "./calibration-banner-client";

// Trust-Layer v0.1.0. CalibrationBanner — server wrapper.
//
// Renders the interactive floating-pill + dialog UI only while we're inside
// the calibration window. Once the launched checkpoint is outside the active
// window, this server component evaluates to null at render time, so cached
// marketing pages ship no client JS for it and the surface disappears cleanly.
//
// The narrative + visual lives in CalibrationBannerClient (a client component
// that owns the dialog open state and the framer-motion micro-interactions).

export function CalibrationBanner() {
  if (!inCalibrationWindow()) return null;
  return <CalibrationBannerClient />;
}
