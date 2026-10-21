from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.peg_signal import PegSignal


T = TypeVar("T", bound="PegFeedResponse")


@_attrs_define
class PegFeedResponse:
    """Batch envelope: a `data` array of per-asset signals (each carries its own
    `mint`), consistent with every other `/v1` list. `methodology` is the global
    version stamped once on the envelope (not repeated per signal). tokens.xyz
    indexes `data[]` by each signal's `mint` into its own per-currency buckets.

        Attributes:
            count (int):
            data (list[PegSignal]):
            generated_at (str): RFC3339 build time; an explicit staleness read independent of HTTP headers.
            methodology (str):
            ok (bool):
    """

    count: int
    data: list[PegSignal]
    generated_at: str
    methodology: str
    ok: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        count = self.count

        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        generated_at = self.generated_at

        methodology = self.methodology

        ok = self.ok

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "count": count,
                "data": data,
                "generated_at": generated_at,
                "methodology": methodology,
                "ok": ok,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.peg_signal import PegSignal

        d = dict(src_dict)
        count = d.pop("count")

        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = PegSignal.from_dict(data_item_data)

            data.append(data_item)

        generated_at = d.pop("generated_at")

        methodology = d.pop("methodology")

        ok = d.pop("ok")

        peg_feed_response = cls(
            count=count,
            data=data,
            generated_at=generated_at,
            methodology=methodology,
            ok=ok,
        )

        peg_feed_response.additional_properties = d
        return peg_feed_response

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
