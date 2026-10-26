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
            snapshot, which is NOT a transition: see `since_is_lower_bound` and
            `history_start`. When `stale` is true it collapses to `updated_at`, the
            moment data stopped.
        since_is_lower_bound (bool): `true` when `since` is at the start of stored history (`since <=
            history_start`): the asset has held this state for the whole recorded
            window and may have entered it earlier, so `since` is a lower bound,
            not a transition time.
        stale (bool): `true` when `updated_at` is older than the 15-minute freshness bound the
            list/detail endpoints enforce; i.e. the feed has likely frozen. Unlike
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
            feed goes stale ("missing data is not confirming data"; H8), so a frozen
            `updated_at` is exactly how a stale/frozen feed surfaces on this endpoint.
        confidence (None | str | Unset): Pyth oracle confidence bucket: `high` | `medium` | `low` | `unknown`.
            The PRICE-ORACLE confidence-interval signal (conf/price ratio); the field
            integrators should gate automation on alongside `state`. Mirrors the list
            endpoint's `confidence`. Collapses to `unknown` when the feed is stale (same
            as `state`), so a frozen feed cannot read as confidently pegged. Omitted only
            when no snapshot carries a confidence value (non-Pyth-dependent assets).
        market_observed_at (datetime.datetime | None | Unset): Latest observed market price tick, when available.
        history_start (datetime.datetime | None | Unset): RFC3339 of the earliest snapshot Pegana has stored for this
            asset; no
            history exists before it. Production history begins
            2026-10-17T09:20Z (the database was rebuilt then), so for assets
            tracked before that it is about that instant. Omitted when unknown.
        state_reason (None | str | Unset): Advisory machine-readable reason for the current state (mirrors
            `discount_snapshots.state_reason` and `Receipt.state_reason`).

            **Emitted today:**
            - `premium_sanity`: engine NAV-sanity override: smoothed discount exceeded
              the premium-sanity bound, state forced to UNKNOWN (intrinsic anchor
              suspect).
            - `stale_source`: API layer: no discount snapshot in the last 15 min
              (sources or engine dark), state collapsed to UNKNOWN.
            - `market_unavailable`: API layer: no discount snapshot in the last 15
              min, but the intrinsic leg IS fresh and no market tick exists in that
              window (thin market, no reliable quote). State UNKNOWN; the other
              fields are from the last discount snapshot (`updated_at` = when it
              stopped), like `stale_source`.

            Additional possible values: `market_reference_divergence`, `depth_below_floor`, `premium_hold_timeout`.

            **Reserved; not yet emitted (planned for depth-gate / oracle-crosscheck
            work):** `no_oracle_crosscheck | intrinsic_unavailable | shallow_market |
            nominal`.

            Omitted when null.
    """

    asset: str
    discount: str
    intrinsic_usd: str
    market_usd: str
    since: datetime.datetime
    since_is_lower_bound: bool
    stale: bool
    state: PegState
    updated_at: datetime.datetime
    confidence: None | str | Unset = UNSET
    history_start: datetime.datetime | None | Unset = UNSET
    market_observed_at: datetime.datetime | None | Unset = UNSET
    state_reason: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        discount = self.discount

        intrinsic_usd = self.intrinsic_usd

        market_usd = self.market_usd

        since = self.since.isoformat()

        since_is_lower_bound = self.since_is_lower_bound

        stale = self.stale

        state = self.state.value

        updated_at = self.updated_at.isoformat()

        confidence: None | str | Unset
        if isinstance(self.confidence, Unset):
            confidence = UNSET
        else:
            confidence = self.confidence

        history_start: None | str | Unset
        if isinstance(self.history_start, Unset):
            history_start = UNSET
        elif isinstance(self.history_start, datetime.datetime):
            history_start = self.history_start.isoformat()
        else:
            history_start = self.history_start

        market_observed_at: None | str | Unset
        if isinstance(self.market_observed_at, Unset):
            market_observed_at = UNSET
        elif isinstance(self.market_observed_at, datetime.datetime):
            market_observed_at = self.market_observed_at.isoformat()
        else:
            market_observed_at = self.market_observed_at

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
                "since_is_lower_bound": since_is_lower_bound,
                "stale": stale,
                "state": state,
                "updated_at": updated_at,
            }
        )
        if confidence is not UNSET:
            field_dict["confidence"] = confidence
        if history_start is not UNSET:
            field_dict["history_start"] = history_start
        if market_observed_at is not UNSET:
            field_dict["market_observed_at"] = market_observed_at
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

        since_is_lower_bound = d.pop("since_is_lower_bound")

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

        def _parse_history_start(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                history_start_type_0 = datetime.datetime.fromisoformat(data)

                return history_start_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        history_start = _parse_history_start(d.pop("history_start", UNSET))

        def _parse_market_observed_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                market_observed_at_type_0 = datetime.datetime.fromisoformat(data)

                return market_observed_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        market_observed_at = _parse_market_observed_at(d.pop("market_observed_at", UNSET))

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
            since_is_lower_bound=since_is_lower_bound,
            stale=stale,
            state=state,
            updated_at=updated_at,
            confidence=confidence,
            history_start=history_start,
            market_observed_at=market_observed_at,
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
