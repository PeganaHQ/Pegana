from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.calibration import Calibration
from ..types import UNSET, Unset

T = TypeVar("T", bound="CalibrationHealth")


@_attrs_define
class CalibrationHealth:
    """
    Attributes:
        calibration (Calibration): Calibration status of an asset (and of an alert that asset emitted).

            - `provisional`: a "beta" asset: released and alerting publicly, but its
              thresholds are not yet validated over a full post-launch calibration
              window. Equivalent to `monitoring_only=true`. Read its alerts as
              experimental.
            - `calibrated`: a fully calibrated asset that counts in the launch
              denominator.

            This is the SAME vocabulary the dispatcher emits on the webhook canonical
            event (`"calibration":"provisional"|"calibrated"`), so a machine consumer
            reading both the webhook fan-out and the REST read surfaces sees one word
            for the concept instead of `calibration` there and `monitoring_only` here.
        health (str): `ok` | `watch` (p95 in the drift band) | `miscalibrated` (p95 beyond the
            depeg band) | `no_data` | `na` (non-bps thresholds).
        monitoring_only (bool): Calibration-status flag (not a health state). `monitoring_only` (beta)
            assets now alert publicly, but their calibration is provisional; the
            flag lets clients label them as beta.
        symbol (str):
        depeg_bps (int | None | Unset):
        drift_bps (int | None | Unset): Asset's own drift / depeg bands (bps), from `assets.thresholds`. `None`
            for the CDP collateral-ratio thresholds shape (hyUSD), where the bps
            comparison does not apply.
        p95_bps (int | None | Unset): Trailing-8d p95 of the direction-sensitive effective discount (bps):
            discount side counts; benign lst/stable_yield premiums are carved out;
            premiums beyond the 10% NAV-sanity bound count as broken anchors. `None`
            when the source is dark (no snapshot, or <200 samples in the 8d window).
        p99_bps (int | None | Unset): Trailing-8d p99 of the direction-sensitive effective discount (bps):
            discount side counts; benign lst/stable_yield premiums are carved out;
            premiums beyond the 10% NAV-sanity bound count as broken anchors. `None`
            when the source is dark (no snapshot, or <200 samples in the 8d window).
    """

    calibration: Calibration
    health: str
    monitoring_only: bool
    symbol: str
    depeg_bps: int | None | Unset = UNSET
    drift_bps: int | None | Unset = UNSET
    p95_bps: int | None | Unset = UNSET
    p99_bps: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        calibration = self.calibration.value

        health = self.health

        monitoring_only = self.monitoring_only

        symbol = self.symbol

        depeg_bps: int | None | Unset
        if isinstance(self.depeg_bps, Unset):
            depeg_bps = UNSET
        else:
            depeg_bps = self.depeg_bps

        drift_bps: int | None | Unset
        if isinstance(self.drift_bps, Unset):
            drift_bps = UNSET
        else:
            drift_bps = self.drift_bps

        p95_bps: int | None | Unset
        if isinstance(self.p95_bps, Unset):
            p95_bps = UNSET
        else:
            p95_bps = self.p95_bps

        p99_bps: int | None | Unset
        if isinstance(self.p99_bps, Unset):
            p99_bps = UNSET
        else:
            p99_bps = self.p99_bps

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "calibration": calibration,
                "health": health,
                "monitoring_only": monitoring_only,
                "symbol": symbol,
            }
        )
        if depeg_bps is not UNSET:
            field_dict["depeg_bps"] = depeg_bps
        if drift_bps is not UNSET:
            field_dict["drift_bps"] = drift_bps
        if p95_bps is not UNSET:
            field_dict["p95_bps"] = p95_bps
        if p99_bps is not UNSET:
            field_dict["p99_bps"] = p99_bps

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        calibration = Calibration(d.pop("calibration"))

        health = d.pop("health")

        monitoring_only = d.pop("monitoring_only")

        symbol = d.pop("symbol")

        def _parse_depeg_bps(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        depeg_bps = _parse_depeg_bps(d.pop("depeg_bps", UNSET))

        def _parse_drift_bps(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        drift_bps = _parse_drift_bps(d.pop("drift_bps", UNSET))

        def _parse_p95_bps(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        p95_bps = _parse_p95_bps(d.pop("p95_bps", UNSET))

        def _parse_p99_bps(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        p99_bps = _parse_p99_bps(d.pop("p99_bps", UNSET))

        calibration_health = cls(
            calibration=calibration,
            health=health,
            monitoring_only=monitoring_only,
            symbol=symbol,
            depeg_bps=depeg_bps,
            drift_bps=drift_bps,
            p95_bps=p95_bps,
            p99_bps=p99_bps,
        )

        calibration_health.additional_properties = d
        return calibration_health

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
