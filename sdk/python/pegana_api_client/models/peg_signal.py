from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.anchor import Anchor
from ..models.calibration import Calibration
from ..models.confidence import Confidence
from ..models.peg_state import PegState
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.systemic_signal import SystemicSignal


T = TypeVar("T", bound="PegSignal")


@_attrs_define
class PegSignal:
    """One asset's peg signal. A superset of the tokens.xyz contract subset; every
    `Option` field is omitted (not null) when absent so a thin consumer can model
    only what it needs.

        Attributes:
            anchor (Anchor): Peg anchor tells a consumer how to interpret the asset's fair value WITHOUT
                knowing Pegana's internal taxonomy:

                - `"USD"` — the asset targets exactly $1 (fiat-backed, RWA, delta-neutral,
                  and CDP stablecoins). A discount from $1 IS the risk signal.

                - `"FX"` — the asset targets a fixed non-USD fiat exchange rate (e.g.
                  EURC→EUR, BRZ→BRL). Read `peg_target` for the specific currency. A
                  discount from the FX rate IS the risk signal.

                - `"NAV"` — the asset's fair value is its intrinsic redemption/net-asset
                  value, which is NOT a fixed fiat rate (LSTs, yield-bearing stables,
                  synthetic leverage). The discount is relative to NAV, and NAV itself
                  moves.

                IMPORTANT: derived from `class`, NOT from `peg_target`. A yield-bearing
                stable can have `peg_target = "USD"` yet `anchor = "NAV"` because its
                price legitimately accrues above $1 over time.
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
            decimals (int):
            mint (str): Canonical Solana mint — the join key each signal carries in the batch
                `data[]` array (index the array by this).
            monitoring_only (bool):
            name (str):
            peg_target (str):
            receipt_url (str): Human/agent verify pointer for this asset.
            stale (bool): True whenever there is no trustworthy fresh discount: `state` is
                UNKNOWN or absent, OR `updated_at` is older than the 15-min freshness
                bound or absent. `updated_at` can be fresh while `stale` is true (it may
                be the intrinsic leg's time when the market leg is missing; see
                `state_reason` `market_unavailable` on `/v1/assets`).
            symbol (str):
            confidence (Confidence | None | Unset):
            discount (None | str | Unset): Signed discount fraction (serialized as a string): the smoothed value
                the state machine classifies, in SOL terms for LSTs. Do not recompute it
                from `intrinsic_usd` / `market_usd`; the USD legs use separate SOL/USD
                reads and can differ by a few bps, near zero even in sign.
            discount_bps (float | None | Unset): Convenience `discount × 10000` in basis points, a JSON number rounded
                to 4 dp. The only ratio field serialized as a number, not a string.
            discount_raw (None | str | Unset): Unsmoothed discount for the same tick (before the EWMA), same basis as
                `discount`. Omitted when there is no fresh snapshot. `discount` (and
                `state`) remain the values to act on; see `AssetCard.discount_raw`.
            intrinsic_usd (None | str | Unset):
            jitter_bps_24h (None | str | Unset):
            market_cap (None | str | Unset): Circulating market cap in USD (circulating supply × market price, mig 0065).
                Serialized as a decimal string; omitted when either factor is unavailable.
            market_usd (None | str | Unset):
            risk_score (int | None | Unset): Composite peg-risk score, 0–100 (higher = riskier) — the single number a
                consumer (e.g. tokens.xyz's risk block) can surface without Pegana's model.
                Derived on `/v1/assets` (`risk_score.rs`); omitted when unavailable.
            state (None | PegState | Unset):
            systemic (None | SystemicSignal | Unset):
            updated_at (None | str | Unset): RFC3339 of the latest snapshot. Omitted when none.
            worst_abs_24h (None | str | Unset):
    """

    anchor: Anchor
    calibration: Calibration
    class_: str
    decimals: int
    mint: str
    monitoring_only: bool
    name: str
    peg_target: str
    receipt_url: str
    stale: bool
    symbol: str
    confidence: Confidence | None | Unset = UNSET
    discount: None | str | Unset = UNSET
    discount_bps: float | None | Unset = UNSET
    discount_raw: None | str | Unset = UNSET
    intrinsic_usd: None | str | Unset = UNSET
    jitter_bps_24h: None | str | Unset = UNSET
    market_cap: None | str | Unset = UNSET
    market_usd: None | str | Unset = UNSET
    risk_score: int | None | Unset = UNSET
    state: None | PegState | Unset = UNSET
    systemic: None | SystemicSignal | Unset = UNSET
    updated_at: None | str | Unset = UNSET
    worst_abs_24h: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.systemic_signal import SystemicSignal

        anchor = self.anchor.value

        calibration = self.calibration.value

        class_ = self.class_

        decimals = self.decimals

        mint = self.mint

        monitoring_only = self.monitoring_only

        name = self.name

        peg_target = self.peg_target

        receipt_url = self.receipt_url

        stale = self.stale

        symbol = self.symbol

        confidence: None | str | Unset
        if isinstance(self.confidence, Unset):
            confidence = UNSET
        elif isinstance(self.confidence, Confidence):
            confidence = self.confidence.value
        else:
            confidence = self.confidence

        discount: None | str | Unset
        if isinstance(self.discount, Unset):
            discount = UNSET
        else:
            discount = self.discount

        discount_bps: float | None | Unset
        if isinstance(self.discount_bps, Unset):
            discount_bps = UNSET
        else:
            discount_bps = self.discount_bps

        discount_raw: None | str | Unset
        if isinstance(self.discount_raw, Unset):
            discount_raw = UNSET
        else:
            discount_raw = self.discount_raw

        intrinsic_usd: None | str | Unset
        if isinstance(self.intrinsic_usd, Unset):
            intrinsic_usd = UNSET
        else:
            intrinsic_usd = self.intrinsic_usd

        jitter_bps_24h: None | str | Unset
        if isinstance(self.jitter_bps_24h, Unset):
            jitter_bps_24h = UNSET
        else:
            jitter_bps_24h = self.jitter_bps_24h

        market_cap: None | str | Unset
        if isinstance(self.market_cap, Unset):
            market_cap = UNSET
        else:
            market_cap = self.market_cap

        market_usd: None | str | Unset
        if isinstance(self.market_usd, Unset):
            market_usd = UNSET
        else:
            market_usd = self.market_usd

        risk_score: int | None | Unset
        if isinstance(self.risk_score, Unset):
            risk_score = UNSET
        else:
            risk_score = self.risk_score

        state: None | str | Unset
        if isinstance(self.state, Unset):
            state = UNSET
        elif isinstance(self.state, PegState):
            state = self.state.value
        else:
            state = self.state

        systemic: dict[str, Any] | None | Unset
        if isinstance(self.systemic, Unset):
            systemic = UNSET
        elif isinstance(self.systemic, SystemicSignal):
            systemic = self.systemic.to_dict()
        else:
            systemic = self.systemic

        updated_at: None | str | Unset
        if isinstance(self.updated_at, Unset):
            updated_at = UNSET
        else:
            updated_at = self.updated_at

        worst_abs_24h: None | str | Unset
        if isinstance(self.worst_abs_24h, Unset):
            worst_abs_24h = UNSET
        else:
            worst_abs_24h = self.worst_abs_24h

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "anchor": anchor,
                "calibration": calibration,
                "class": class_,
                "decimals": decimals,
                "mint": mint,
                "monitoring_only": monitoring_only,
                "name": name,
                "peg_target": peg_target,
                "receipt_url": receipt_url,
                "stale": stale,
                "symbol": symbol,
            }
        )
        if confidence is not UNSET:
            field_dict["confidence"] = confidence
        if discount is not UNSET:
            field_dict["discount"] = discount
        if discount_bps is not UNSET:
            field_dict["discount_bps"] = discount_bps
        if discount_raw is not UNSET:
            field_dict["discount_raw"] = discount_raw
        if intrinsic_usd is not UNSET:
            field_dict["intrinsic_usd"] = intrinsic_usd
        if jitter_bps_24h is not UNSET:
            field_dict["jitter_bps_24h"] = jitter_bps_24h
        if market_cap is not UNSET:
            field_dict["market_cap"] = market_cap
        if market_usd is not UNSET:
            field_dict["market_usd"] = market_usd
        if risk_score is not UNSET:
            field_dict["risk_score"] = risk_score
        if state is not UNSET:
            field_dict["state"] = state
        if systemic is not UNSET:
            field_dict["systemic"] = systemic
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at
        if worst_abs_24h is not UNSET:
            field_dict["worst_abs_24h"] = worst_abs_24h

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.systemic_signal import SystemicSignal

        d = dict(src_dict)
        anchor = Anchor(d.pop("anchor"))

        calibration = Calibration(d.pop("calibration"))

        class_ = d.pop("class")

        decimals = d.pop("decimals")

        mint = d.pop("mint")

        monitoring_only = d.pop("monitoring_only")

        name = d.pop("name")

        peg_target = d.pop("peg_target")

        receipt_url = d.pop("receipt_url")

        stale = d.pop("stale")

        symbol = d.pop("symbol")

        def _parse_confidence(data: object) -> Confidence | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                confidence_type_1 = Confidence(data)

                return confidence_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(Confidence | None | Unset, data)

        confidence = _parse_confidence(d.pop("confidence", UNSET))

        def _parse_discount(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        discount = _parse_discount(d.pop("discount", UNSET))

        def _parse_discount_bps(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        discount_bps = _parse_discount_bps(d.pop("discount_bps", UNSET))

        def _parse_discount_raw(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        discount_raw = _parse_discount_raw(d.pop("discount_raw", UNSET))

        def _parse_intrinsic_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        intrinsic_usd = _parse_intrinsic_usd(d.pop("intrinsic_usd", UNSET))

        def _parse_jitter_bps_24h(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        jitter_bps_24h = _parse_jitter_bps_24h(d.pop("jitter_bps_24h", UNSET))

        def _parse_market_cap(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        market_cap = _parse_market_cap(d.pop("market_cap", UNSET))

        def _parse_market_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        market_usd = _parse_market_usd(d.pop("market_usd", UNSET))

        def _parse_risk_score(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        risk_score = _parse_risk_score(d.pop("risk_score", UNSET))

        def _parse_state(data: object) -> None | PegState | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                state_type_1 = PegState(data)

                return state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PegState | Unset, data)

        state = _parse_state(d.pop("state", UNSET))

        def _parse_systemic(data: object) -> None | SystemicSignal | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                systemic_type_1 = SystemicSignal.from_dict(data)

                return systemic_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | SystemicSignal | Unset, data)

        systemic = _parse_systemic(d.pop("systemic", UNSET))

        def _parse_updated_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        updated_at = _parse_updated_at(d.pop("updated_at", UNSET))

        def _parse_worst_abs_24h(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        worst_abs_24h = _parse_worst_abs_24h(d.pop("worst_abs_24h", UNSET))

        peg_signal = cls(
            anchor=anchor,
            calibration=calibration,
            class_=class_,
            decimals=decimals,
            mint=mint,
            monitoring_only=monitoring_only,
            name=name,
            peg_target=peg_target,
            receipt_url=receipt_url,
            stale=stale,
            symbol=symbol,
            confidence=confidence,
            discount=discount,
            discount_bps=discount_bps,
            discount_raw=discount_raw,
            intrinsic_usd=intrinsic_usd,
            jitter_bps_24h=jitter_bps_24h,
            market_cap=market_cap,
            market_usd=market_usd,
            risk_score=risk_score,
            state=state,
            systemic=systemic,
            updated_at=updated_at,
            worst_abs_24h=worst_abs_24h,
        )

        peg_signal.additional_properties = d
        return peg_signal

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
