from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.confidence import Confidence
from ..models.peg_state import PegState
from ..types import UNSET, Unset

T = TypeVar("T", bound="AuditCsvRow")


@_attrs_define
class AuditCsvRow:
    """One row of the streaming CSV from `GET /v1/audit.csv`. axum-streams
    derives header + row encoding from `serde::Serialize`.

        Attributes:
            alert_id (str):
            asset (str):
            assets_toml_sha256 (str):
            class_ (str):
            confidence (Confidence): Pyth oracle confidence bucket. Mirrors `pyth_confidence_label`. Scopes the
                PRICE-ORACLE confidence interval only (conf/price ratio) — NOT market-quote
                or route-depth reliability.
            detected_at (str):
            discount (str):
            from_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
                `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
                fields across the API.

                The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
                spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
                this value directly rather than imposing a naive discount cut.
            intrinsic_usd (str):
            market_usd (str):
            methodology_version (str):
            receipt_sha256 (str):
            to_state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
                `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
                fields across the API.

                The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
                spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
                this value directly rather than imposing a naive discount cut.
            onchain_tx_sig (None | str | Unset):
    """

    alert_id: str
    asset: str
    assets_toml_sha256: str
    class_: str
    confidence: Confidence
    detected_at: str
    discount: str
    from_state: PegState
    intrinsic_usd: str
    market_usd: str
    methodology_version: str
    receipt_sha256: str
    to_state: PegState
    onchain_tx_sig: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        alert_id = self.alert_id

        asset = self.asset

        assets_toml_sha256 = self.assets_toml_sha256

        class_ = self.class_

        confidence = self.confidence.value

        detected_at = self.detected_at

        discount = self.discount

        from_state = self.from_state.value

        intrinsic_usd = self.intrinsic_usd

        market_usd = self.market_usd

        methodology_version = self.methodology_version

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
                "alert_id": alert_id,
                "asset": asset,
                "assets_toml_sha256": assets_toml_sha256,
                "class": class_,
                "confidence": confidence,
                "detected_at": detected_at,
                "discount": discount,
                "from_state": from_state,
                "intrinsic_usd": intrinsic_usd,
                "market_usd": market_usd,
                "methodology_version": methodology_version,
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
        alert_id = d.pop("alert_id")

        asset = d.pop("asset")

        assets_toml_sha256 = d.pop("assets_toml_sha256")

        class_ = d.pop("class")

        confidence = Confidence(d.pop("confidence"))

        detected_at = d.pop("detected_at")

        discount = d.pop("discount")

        from_state = PegState(d.pop("from_state"))

        intrinsic_usd = d.pop("intrinsic_usd")

        market_usd = d.pop("market_usd")

        methodology_version = d.pop("methodology_version")

        receipt_sha256 = d.pop("receipt_sha256")

        to_state = PegState(d.pop("to_state"))

        def _parse_onchain_tx_sig(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        onchain_tx_sig = _parse_onchain_tx_sig(d.pop("onchain_tx_sig", UNSET))

        audit_csv_row = cls(
            alert_id=alert_id,
            asset=asset,
            assets_toml_sha256=assets_toml_sha256,
            class_=class_,
            confidence=confidence,
            detected_at=detected_at,
            discount=discount,
            from_state=from_state,
            intrinsic_usd=intrinsic_usd,
            market_usd=market_usd,
            methodology_version=methodology_version,
            receipt_sha256=receipt_sha256,
            to_state=to_state,
            onchain_tx_sig=onchain_tx_sig,
        )

        audit_csv_row.additional_properties = d
        return audit_csv_row

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
