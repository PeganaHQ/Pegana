from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.peg_state import PegState
from ..types import UNSET, Unset

T = TypeVar("T", bound="StateResp")


@_attrs_define
class StateResp:
    """
    Attributes:
        asset (str):
        discount (str):
        intrinsic_usd (str):
        market_usd (str):
        since (datetime.datetime): Timestamp of the most recent transition into the current state: the
            first snapshot of the current contiguous run. Constant across
            recomputes; it changes ONLY on a real state transition. For an asset
            that has only ever held one state it is that asset's first observed
            snapshot. When `stale` is true it collapses to `updated_at`, the moment
            data stopped.
        stale (bool): `true` when `updated_at` is older than the 15-minute freshness bound the
            list/detail endpoints enforce — i.e. the feed has likely frozen. Unlike
            list/detail, `/state` still returns the last value rather than 404-hiding
            it; read this flag to fail safe. Consumers needing a tighter bound can
            derive their own from `updated_at`.
        state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
            `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
            fields across the API.

            The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
            spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
            this value directly rather than imposing a naive discount cut.
        updated_at (datetime.datetime): Timestamp the current snapshot was computed (the latest
            `discount_snapshots.ts`). Distinct from `since` (state-transition time):
            this is the FRESHNESS signal. The engine stops writing snapshots when a
            feed goes stale ("missing data is not confirming data" — H8), so a frozen
            `updated_at` is exactly how a stale/frozen feed surfaces on this endpoint.
        confidence (None | str | Unset): Pyth oracle confidence bucket: `high` | `medium` | `low` | `unknown`.
            The PRICE-ORACLE confidence-interval signal (conf/price ratio) — the field
            integrators should gate automation on alongside `state`. Mirrors the list
            endpoint's `confidence`. Collapses to `unknown` when the feed is stale (same
            as `state`), so a frozen feed cannot read as confidently pegged. Omitted only
            when no snapshot carries a confidence value (non-Pyth-dependent assets).
        state_reason (None | str | Unset): Advisory machine-readable reason for the current state (mirrors
            `discount_snapshots.state_reason` and `Receipt.state_reason`).

            **Emitted today:**
            - `premium_sanity` — engine NAV-sanity override: smoothed discount exceeded
              the premium-sanity bound, state forced to UNKNOWN (intrinsic anchor
              suspect).
            - `stale_source` — API layer: feed is >15 min stale, state collapsed to
              UNKNOWN; no fresh discount snapshot exists.

            **Reserved — not yet emitted (planned for depth-gate / oracle-crosscheck
            work):** `no_oracle_crosscheck | intrinsic_unavailable | shallow_market |
            nominal`.

            Omitted when null.
    """

    asset: str
    discount: str
    intrinsic_usd: str
    market_usd: str
    since: datetime.datetime
    stale: bool
    state: PegState
    updated_at: datetime.datetime
    confidence: None | str | Unset = UNSET
    state_reason: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        discount = self.discount

        intrinsic_usd = self.intrinsic_usd

        market_usd = self.market_usd

        since = self.since.isoformat()

        stale = self.stale

        state = self.state.value

        updated_at = self.updated_at.isoformat()

        confidence: None | str | Unset
        if isinstance(self.confidence, Unset):
            confidence = UNSET
        else:
            confidence = self.confidence

        state_reason: None | str | Unset
        if isinstance(self.state_reason, Unset):
            state_reason = UNSET
        else:
            state_reason = self.state_reason

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "asset": asset,
                "discount": discount,
                "intrinsic_usd": intrinsic_usd,
                "market_usd": market_usd,
                "since": since,
                "stale": stale,
                "state": state,
                "updated_at": updated_at,
            }
        )
        if confidence is not UNSET:
            field_dict["confidence"] = confidence
        if state_reason is not UNSET:
            field_dict["state_reason"] = state_reason

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        asset = d.pop("asset")

        discount = d.pop("discount")

        intrinsic_usd = d.pop("intrinsic_usd")

        market_usd = d.pop("market_usd")

        since = datetime.datetime.fromisoformat(d.pop("since"))

        stale = d.pop("stale")

        state = PegState(d.pop("state"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updated_at"))

        def _parse_confidence(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        confidence = _parse_confidence(d.pop("confidence", UNSET))

        def _parse_state_reason(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        state_reason = _parse_state_reason(d.pop("state_reason", UNSET))

        state_resp = cls(
            asset=asset,
            discount=discount,
            intrinsic_usd=intrinsic_usd,
            market_usd=market_usd,
            since=since,
            stale=stale,
            state=state,
            updated_at=updated_at,
            confidence=confidence,
            state_reason=state_reason,
        )

        state_resp.additional_properties = d
        return state_resp

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
