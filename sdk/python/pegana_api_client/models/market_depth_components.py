from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="MarketDepthComponents")


@_attrs_define
class MarketDepthComponents:
    """Per-component detail, so the UI can explain the number instead of asserting it.

    Attributes:
        holders (int | None | Unset): 0-100 from `holder_count`. `null` when unobserved.
        liquidity (int | None | Unset): 0-100 from `liquidity_usd`. `null` when unobserved.
        volume (int | None | Unset): 0-100 from `volume_24h_usd`. `null` when unobserved.
    """

    holders: int | None | Unset = UNSET
    liquidity: int | None | Unset = UNSET
    volume: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        holders: int | None | Unset
        if isinstance(self.holders, Unset):
            holders = UNSET
        else:
            holders = self.holders

        liquidity: int | None | Unset
        if isinstance(self.liquidity, Unset):
            liquidity = UNSET
        else:
            liquidity = self.liquidity

        volume: int | None | Unset
        if isinstance(self.volume, Unset):
            volume = UNSET
        else:
            volume = self.volume

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if holders is not UNSET:
            field_dict["holders"] = holders
        if liquidity is not UNSET:
            field_dict["liquidity"] = liquidity
        if volume is not UNSET:
            field_dict["volume"] = volume

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)

        def _parse_holders(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        holders = _parse_holders(d.pop("holders", UNSET))

        def _parse_liquidity(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        liquidity = _parse_liquidity(d.pop("liquidity", UNSET))

        def _parse_volume(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        volume = _parse_volume(d.pop("volume", UNSET))

        market_depth_components = cls(
            holders=holders,
            liquidity=liquidity,
            volume=volume,
        )

        market_depth_components.additional_properties = d
        return market_depth_components

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
