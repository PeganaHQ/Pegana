from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.peg_state import PegState
from ..types import UNSET, Unset

T = TypeVar("T", bound="HistoryPoint")


@_attrs_define
class HistoryPoint:
    """
    Attributes:
        discount (str): EWMA-smoothed discount (the value the state machine uses).
        state (PegState): Class-aware peg state. Mirrors the engine `PegState` enum and the
            `peg_state` Postgres enum. Used for `state`, `from_state`, and `to_state`
            fields across the API.

            The state is CLASS-AWARE: an LST reading a −1.4% discount (normal unstaking
            spread) is `PEGGED`, while a fiat stable at far less would be `DRIFT`. Trust
            this value directly rather than imposing a naive discount cut.
        ts (datetime.datetime):
        discount_raw (None | str | Unset): Raw discount sample (`1 - market/intrinsic`) before EWMA smoothing.
            `None` for `bucket=1m` because the continuous aggregate
            `discount_1m` only stores `avg(discount_smooth)`. For `bucket=raw`,
            populated from `discount_snapshots.discount_raw`.
        intrinsic_usd (None | str | Unset): Intrinsic (NAV) leg in USD — the fair-value denominator of the
            discount. `None` for `bucket=1m` (the `discount_1m` aggregate stores no
            legs); for `bucket=raw`, the `discount_snapshots.intrinsic_usd` column
            (`NOT NULL`). Lets the asset-detail "Legs" view distinguish a market
            crash from a NAV re-rating — the two legs the single zeroed spread line
            structurally cannot separate. USD-denominated, so only meaningful for
            USD-peg assets (the client gates the view on `peg_target = USD`).
        market_usd (None | str | Unset): Market leg in USD — the traded price numerator of the discount. Same
            `None`-for-1m / present-for-raw semantics as `intrinsic_usd`, from
            `discount_snapshots.market_usd` (`NOT NULL`).
        oracle_usd (None | str | Unset): Pyth ORACLE leg in USD — a THIRD, structurally independent price source
            (vs the DEX `market_usd` and the NAV `intrinsic_usd`), for the 3-leg
            "sources disagree" view. asof-joined from `oracle_snapshots` on the
            asset's `pyth_feed_id` (0x-normalized to the indexer's stored form).
            `None` for `bucket=1m`. For `bucket=raw`, `None` unless ALL hold: the
            market is a DEX source (`market_kind` jupiter_usd/dex_screener_usd, so
            the oracle is independent, not a duplicate of a `pyth_*` market), the
            asset's `peg_target` is USD (the oracle leg is a USD price — excludes
            SOL/BRL/EUR-peg assets like the LSTs, BRZ, EURC whose `<asset>/USD`
            feed isn't their peg), the asset carries a `pyth_feed_id`, AND that
            feed actually streams into
            `oracle_snapshots`. The `market_kind`+`pyth_feed_id` CASE is only a
            cheap pre-filter, NOT a subscription proof — `pyth_feed_id` is display
            metadata that can name a feed the indexer's `[pyth_feeds]` set never
            subscribes; such feeds yield no `oracle_snapshots` rows, so the asof
            subquery returns NULL and the leg quietly stays hidden. So the leg
            appears only where it's genuinely honest (independent + real data).
    """

    discount: str
    state: PegState
    ts: datetime.datetime
    discount_raw: None | str | Unset = UNSET
    intrinsic_usd: None | str | Unset = UNSET
    market_usd: None | str | Unset = UNSET
    oracle_usd: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        discount = self.discount

        state = self.state.value

        ts = self.ts.isoformat()

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

        market_usd: None | str | Unset
        if isinstance(self.market_usd, Unset):
            market_usd = UNSET
        else:
            market_usd = self.market_usd

        oracle_usd: None | str | Unset
        if isinstance(self.oracle_usd, Unset):
            oracle_usd = UNSET
        else:
            oracle_usd = self.oracle_usd

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "discount": discount,
                "state": state,
                "ts": ts,
            }
        )
        if discount_raw is not UNSET:
            field_dict["discount_raw"] = discount_raw
        if intrinsic_usd is not UNSET:
            field_dict["intrinsic_usd"] = intrinsic_usd
        if market_usd is not UNSET:
            field_dict["market_usd"] = market_usd
        if oracle_usd is not UNSET:
            field_dict["oracle_usd"] = oracle_usd

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        discount = d.pop("discount")

        state = PegState(d.pop("state"))

        ts = datetime.datetime.fromisoformat(d.pop("ts"))

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

        def _parse_market_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        market_usd = _parse_market_usd(d.pop("market_usd", UNSET))

        def _parse_oracle_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        oracle_usd = _parse_oracle_usd(d.pop("oracle_usd", UNSET))

        history_point = cls(
            discount=discount,
            state=state,
            ts=ts,
            discount_raw=discount_raw,
            intrinsic_usd=intrinsic_usd,
            market_usd=market_usd,
            oracle_usd=oracle_usd,
        )

        history_point.additional_properties = d
        return history_point

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
