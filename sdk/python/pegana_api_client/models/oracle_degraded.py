from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="OracleDegraded")


@_attrs_define
class OracleDegraded:
    """Advisory oracle-vs-market divergence annotation for a single asset. Never
    a receipt input; never part of the canonical hash; purely additive on the
    single-asset detail response. Omitted entirely (not `null`) via the
    `Option<OracleDegraded>` field's `skip_serializing_if` on `AssetCard`.

        Attributes:
            reason (str): Machine-readable reason. Worst-first priority when multiple guards
                fire in the same tick: `oracle_divergence` > `oracle_confidence_wide`
                > `oracle_stale`.
            age_secs (int | None | Unset): Seconds elapsed since the asof-joined oracle snapshot was published.
                `None` only when no oracle snapshot was found at all (in which case
                the whole annotation is `None` too — this field is always populated
                whenever `OracleDegraded` is `Some`).
            conf_bps (int | None | Unset): `oracle_conf / oracle_usd`, in bps. `None` when the oracle snapshot
                carried no confidence interval, or the computation overflowed.
            spread_bps (int | None | Unset): `|market_usd - oracle_usd| / oracle_usd`, in bps. `None` when
                `market_usd` was absent/non-positive, or the computation overflowed.
    """

    reason: str
    age_secs: int | None | Unset = UNSET
    conf_bps: int | None | Unset = UNSET
    spread_bps: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason

        age_secs: int | None | Unset
        if isinstance(self.age_secs, Unset):
            age_secs = UNSET
        else:
            age_secs = self.age_secs

        conf_bps: int | None | Unset
        if isinstance(self.conf_bps, Unset):
            conf_bps = UNSET
        else:
            conf_bps = self.conf_bps

        spread_bps: int | None | Unset
        if isinstance(self.spread_bps, Unset):
            spread_bps = UNSET
        else:
            spread_bps = self.spread_bps

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "reason": reason,
            }
        )
        if age_secs is not UNSET:
            field_dict["age_secs"] = age_secs
        if conf_bps is not UNSET:
            field_dict["conf_bps"] = conf_bps
        if spread_bps is not UNSET:
            field_dict["spread_bps"] = spread_bps

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        reason = d.pop("reason")

        def _parse_age_secs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        age_secs = _parse_age_secs(d.pop("age_secs", UNSET))

        def _parse_conf_bps(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        conf_bps = _parse_conf_bps(d.pop("conf_bps", UNSET))

        def _parse_spread_bps(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        spread_bps = _parse_spread_bps(d.pop("spread_bps", UNSET))

        oracle_degraded = cls(
            reason=reason,
            age_secs=age_secs,
            conf_bps=conf_bps,
            spread_bps=spread_bps,
        )

        oracle_degraded.additional_properties = d
        return oracle_degraded

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
