from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.market_depth_components import MarketDepthComponents


T = TypeVar("T", bound="MarketDepth")


@_attrs_define
class MarketDepth:
    """Derived market-depth annotation attached to an `AssetCard`.

    Attributes:
        caps (list[str]): Which hard facts capped the score, if any. Empty when nothing capped it.
        components (MarketDepthComponents): Per-component detail, so the UI can explain the number instead of asserting
            it.
        insufficient_reason (None | str | Unset): Why `score` is `null`. `None` whenever `score` is `Some`.
        score (int | None | Unset): 0-100, higher = more executable market. `null` when the inputs are too
            sparse to state a number honestly; read `insufficient_reason` then.
    """

    caps: list[str]
    components: MarketDepthComponents
    insufficient_reason: None | str | Unset = UNSET
    score: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        caps = self.caps

        components = self.components.to_dict()

        insufficient_reason: None | str | Unset
        if isinstance(self.insufficient_reason, Unset):
            insufficient_reason = UNSET
        else:
            insufficient_reason = self.insufficient_reason

        score: int | None | Unset
        if isinstance(self.score, Unset):
            score = UNSET
        else:
            score = self.score

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "caps": caps,
                "components": components,
            }
        )
        if insufficient_reason is not UNSET:
            field_dict["insufficient_reason"] = insufficient_reason
        if score is not UNSET:
            field_dict["score"] = score

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.market_depth_components import MarketDepthComponents

        d = dict(src_dict)
        caps = cast(list[str], d.pop("caps"))

        components = MarketDepthComponents.from_dict(d.pop("components"))

        def _parse_insufficient_reason(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        insufficient_reason = _parse_insufficient_reason(
            d.pop("insufficient_reason", UNSET)
        )

        def _parse_score(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        score = _parse_score(d.pop("score", UNSET))

        market_depth = cls(
            caps=caps,
            components=components,
            insufficient_reason=insufficient_reason,
            score=score,
        )

        market_depth.additional_properties = d
        return market_depth

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
