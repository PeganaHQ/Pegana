from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.confidence import Confidence
from ..models.peg_state import PegState

T = TypeVar("T", bound="AuditAlert")


@_attrs_define
class AuditAlert:
    """The `alert` object inside a 200 receipt body (`GET /v1/audit/{alert_id}`).
    Decimal money fields are JSON strings (preserves precision).

        Attributes:
            asset (str):
            class_ (str):
            confidence (Confidence): Pyth oracle confidence bucket. Mirrors `pyth_confidence_label`. Scopes the
                PRICE-ORACLE confidence interval only (conf/price ratio) — NOT market-quote
                or route-depth reliability.
            detected_at (datetime.datetime):
            discount (str): Signed discount fraction at detection, as a decimal string.
            from_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
                `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
                fields across the API.

                The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
                spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
                this value directly rather than imposing a naive discount cut.
            id (str): Alert UUID.
            intrinsic_usd (str):
            market_usd (str):
            to_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
                `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
                fields across the API.

                The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
                spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
                this value directly rather than imposing a naive discount cut.
    """

    asset: str
    class_: str
    confidence: Confidence
    detected_at: datetime.datetime
    discount: str
    from_state: PegState
    id: str
    intrinsic_usd: str
    market_usd: str
    to_state: PegState
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        class_ = self.class_

        confidence = self.confidence.value

        detected_at = self.detected_at.isoformat()

        discount = self.discount

        from_state = self.from_state.value

        id = self.id

        intrinsic_usd = self.intrinsic_usd

        market_usd = self.market_usd

        to_state = self.to_state.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "asset": asset,
                "class": class_,
                "confidence": confidence,
                "detected_at": detected_at,
                "discount": discount,
                "from_state": from_state,
                "id": id,
                "intrinsic_usd": intrinsic_usd,
                "market_usd": market_usd,
                "to_state": to_state,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        asset = d.pop("asset")

        class_ = d.pop("class")

        confidence = Confidence(d.pop("confidence"))

        detected_at = datetime.datetime.fromisoformat(d.pop("detected_at"))

        discount = d.pop("discount")

        from_state = PegState(d.pop("from_state"))

        id = d.pop("id")

        intrinsic_usd = d.pop("intrinsic_usd")

        market_usd = d.pop("market_usd")

        to_state = PegState(d.pop("to_state"))

        audit_alert = cls(
            asset=asset,
            class_=class_,
            confidence=confidence,
            detected_at=detected_at,
            discount=discount,
            from_state=from_state,
            id=id,
            intrinsic_usd=intrinsic_usd,
            market_usd=market_usd,
            to_state=to_state,
        )

        audit_alert.additional_properties = d
        return audit_alert

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
