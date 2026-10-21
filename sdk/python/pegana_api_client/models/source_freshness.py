from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SourceFreshness")


@_attrs_define
class SourceFreshness:
    """
    Attributes:
        hylo_secs (int | None | Unset): Seconds since the most recent `hylo_state_snapshots` row (Hylo
            Exchange CR + reserve snapshot).
        jupiter_secs (int | None | Unset): Seconds since the most recent `market_snapshots` row. Jupiter is the
            primary writer; dexscreener fallback also lands here.
        pyth_secs (int | None | Unset): Seconds since the most recent `oracle_snapshots.publish_time` (Pyth
            SSE stream).
        sanctum_secs (int | None | Unset): Seconds since the most recent `intrinsic_snapshots` row written by
            the Sanctum LST adapter (`source LIKE 'sanctum%'`). `None` means no
            row yet; cold start, or the source has never come up.
    """

    hylo_secs: int | None | Unset = UNSET
    jupiter_secs: int | None | Unset = UNSET
    pyth_secs: int | None | Unset = UNSET
    sanctum_secs: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        hylo_secs: int | None | Unset
        if isinstance(self.hylo_secs, Unset):
            hylo_secs = UNSET
        else:
            hylo_secs = self.hylo_secs

        jupiter_secs: int | None | Unset
        if isinstance(self.jupiter_secs, Unset):
            jupiter_secs = UNSET
        else:
            jupiter_secs = self.jupiter_secs

        pyth_secs: int | None | Unset
        if isinstance(self.pyth_secs, Unset):
            pyth_secs = UNSET
        else:
            pyth_secs = self.pyth_secs

        sanctum_secs: int | None | Unset
        if isinstance(self.sanctum_secs, Unset):
            sanctum_secs = UNSET
        else:
            sanctum_secs = self.sanctum_secs

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if hylo_secs is not UNSET:
            field_dict["hylo_secs"] = hylo_secs
        if jupiter_secs is not UNSET:
            field_dict["jupiter_secs"] = jupiter_secs
        if pyth_secs is not UNSET:
            field_dict["pyth_secs"] = pyth_secs
        if sanctum_secs is not UNSET:
            field_dict["sanctum_secs"] = sanctum_secs

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)

        def _parse_hylo_secs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        hylo_secs = _parse_hylo_secs(d.pop("hylo_secs", UNSET))

        def _parse_jupiter_secs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        jupiter_secs = _parse_jupiter_secs(d.pop("jupiter_secs", UNSET))

        def _parse_pyth_secs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        pyth_secs = _parse_pyth_secs(d.pop("pyth_secs", UNSET))

        def _parse_sanctum_secs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        sanctum_secs = _parse_sanctum_secs(d.pop("sanctum_secs", UNSET))

        source_freshness = cls(
            hylo_secs=hylo_secs,
            jupiter_secs=jupiter_secs,
            pyth_secs=pyth_secs,
            sanctum_secs=sanctum_secs,
        )

        source_freshness.additional_properties = d
        return source_freshness

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
