from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.calibration import Calibration
from ..models.peg_state import PegState
from ..types import UNSET, Unset

T = TypeVar("T", bound="AuditIndexRow")


@_attrs_define
class AuditIndexRow:
    """One row of the `GET /v1/audit` index array.

    Attributes:
        asset (str):
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
        detected_at (datetime.datetime):
        from_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
            `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
            fields across the API.

            The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
            spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
            this value directly rather than imposing a naive discount cut.
        id (str):
        methodology_version (str):
        monitoring_only (bool): True for a released `monitoring_only` (beta) asset; provisional
            calibration. Present at runtime since the beta release; this field
            re-aligns the documented schema with the wire (it was emitted but not
            declared). Always present.
        receipt_sha256 (str):
        to_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
            `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
            fields across the API.

            The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
            spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
            this value directly rather than imposing a naive discount cut.
        onchain_tx_sig (None | str | Unset):
    """

    asset: str
    calibration: Calibration
    detected_at: datetime.datetime
    from_state: PegState
    id: str
    methodology_version: str
    monitoring_only: bool
    receipt_sha256: str
    to_state: PegState
    onchain_tx_sig: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        calibration = self.calibration.value

        detected_at = self.detected_at.isoformat()

        from_state = self.from_state.value

        id = self.id

        methodology_version = self.methodology_version

        monitoring_only = self.monitoring_only

        receipt_sha256 = self.receipt_sha256

        to_state = self.to_state.value

        onchain_tx_sig: None | str | Unset
        if isinstance(self.onchain_tx_sig, Unset):
            onchain_tx_sig = UNSET
        else:
            onchain_tx_sig = self.onchain_tx_sig

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "asset": asset,
                "calibration": calibration,
                "detected_at": detected_at,
                "from_state": from_state,
                "id": id,
                "methodology_version": methodology_version,
                "monitoring_only": monitoring_only,
                "receipt_sha256": receipt_sha256,
                "to_state": to_state,
            }
        )
        if onchain_tx_sig is not UNSET:
            field_dict["onchain_tx_sig"] = onchain_tx_sig

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        asset = d.pop("asset")

        calibration = Calibration(d.pop("calibration"))

        detected_at = datetime.datetime.fromisoformat(d.pop("detected_at"))

        from_state = PegState(d.pop("from_state"))

        id = d.pop("id")

        methodology_version = d.pop("methodology_version")

        monitoring_only = d.pop("monitoring_only")

        receipt_sha256 = d.pop("receipt_sha256")

        to_state = PegState(d.pop("to_state"))

        def _parse_onchain_tx_sig(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        onchain_tx_sig = _parse_onchain_tx_sig(d.pop("onchain_tx_sig", UNSET))

        audit_index_row = cls(
            asset=asset,
            calibration=calibration,
            detected_at=detected_at,
            from_state=from_state,
            id=id,
            methodology_version=methodology_version,
            monitoring_only=monitoring_only,
            receipt_sha256=receipt_sha256,
            to_state=to_state,
            onchain_tx_sig=onchain_tx_sig,
        )

        audit_index_row.additional_properties = d
        return audit_index_row

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
