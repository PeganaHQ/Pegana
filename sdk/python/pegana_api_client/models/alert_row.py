from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.calibration import Calibration
from ..models.peg_state import PegState
from ..types import UNSET, Unset
from typing import cast
from uuid import UUID
import datetime






T = TypeVar("T", bound="AlertRow")



@_attrs_define
class AlertRow:
    """ 
        Attributes:
            asset (str):
            calibration (Calibration): Calibration status of an asset (and of an alert that asset emitted).

                - `provisional` — a "beta" asset: released and alerting publicly, but its
                  thresholds are not yet validated over a full post-launch calibration
                  window. Equivalent to `monitoring_only=true`. Read its alerts as
                  experimental.
                - `calibrated` — a fully calibrated asset that counts in the launch
                  denominator.

                This is the SAME vocabulary the dispatcher emits on the webhook canonical
                event (`"calibration":"provisional"|"calibrated"`), so a machine consumer
                reading both the webhook fan-out and the REST read surfaces sees one word
                for the concept instead of `calibration` there and `monitoring_only` here.
            class_ (str):
            detected_at (datetime.datetime):
            from_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
                `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
                fields across the API.

                The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
                spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
                this value directly rather than imposing a naive discount cut.
            id (UUID):
            monitoring_only (bool): True for a released `monitoring_only` (beta) asset — its calibration is
                provisional, so this alert should be read as experimental. Always
                present so public-ledger consumers can label beta rows.
            to_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
                `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
                fields across the API.

                The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
                spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
                this value directly rather than imposing a naive discount cut.
            discount (None | str | Unset): Signed discount (spread) captured at detection, as a rust_decimal
                string. Lets the /events feed show each transition's spread magnitude
                without a second per-row lookup. `None` for older rows where the
                `alerts.discount` column is NULL — the client falls back to the asset's
                live spread, so the field is additive (omitted, never `null`).
            dispatched_at (datetime.datetime | None | Unset): `null` until the dispatcher delivers this alert to its first
                fan-out
                target (Telegram or a webhook subscriber); stamped once at least one
                delivery succeeds. Stays `null` when the alert matched no subscriber —
                nothing was delivered — so a `null` here means "not delivered", NOT
                "delivery failed". Distinct from `detected_at` (when the engine saw the
                transition) and from on-chain commit (a separate evidence path).
     """

    asset: str
    calibration: Calibration
    class_: str
    detected_at: datetime.datetime
    from_state: PegState
    id: UUID
    monitoring_only: bool
    to_state: PegState
    discount: None | str | Unset = UNSET
    dispatched_at: datetime.datetime | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        calibration = self.calibration.value

        class_ = self.class_

        detected_at = self.detected_at.isoformat()

        from_state = self.from_state.value

        id = str(self.id)

        monitoring_only = self.monitoring_only

        to_state = self.to_state.value

        discount: None | str | Unset
        if isinstance(self.discount, Unset):
            discount = UNSET
        else:
            discount = self.discount

        dispatched_at: None | str | Unset
        if isinstance(self.dispatched_at, Unset):
            dispatched_at = UNSET
        elif isinstance(self.dispatched_at, datetime.datetime):
            dispatched_at = self.dispatched_at.isoformat()
        else:
            dispatched_at = self.dispatched_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "asset": asset,
            "calibration": calibration,
            "class": class_,
            "detected_at": detected_at,
            "from_state": from_state,
            "id": id,
            "monitoring_only": monitoring_only,
            "to_state": to_state,
        })
        if discount is not UNSET:
            field_dict["discount"] = discount
        if dispatched_at is not UNSET:
            field_dict["dispatched_at"] = dispatched_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        asset = d.pop("asset")

        calibration = Calibration(d.pop("calibration"))




        class_ = d.pop("class")

        detected_at = datetime.datetime.fromisoformat(d.pop("detected_at"))




        from_state = PegState(d.pop("from_state"))




        id = UUID(d.pop("id"))




        monitoring_only = d.pop("monitoring_only")

        to_state = PegState(d.pop("to_state"))




        def _parse_discount(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        discount = _parse_discount(d.pop("discount", UNSET))


        def _parse_dispatched_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                dispatched_at_type_0 = datetime.datetime.fromisoformat(data)



                return dispatched_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        dispatched_at = _parse_dispatched_at(d.pop("dispatched_at", UNSET))


        alert_row = cls(
            asset=asset,
            calibration=calibration,
            class_=class_,
            detected_at=detected_at,
            from_state=from_state,
            id=id,
            monitoring_only=monitoring_only,
            to_state=to_state,
            discount=discount,
            dispatched_at=dispatched_at,
        )


        alert_row.additional_properties = d
        return alert_row

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
