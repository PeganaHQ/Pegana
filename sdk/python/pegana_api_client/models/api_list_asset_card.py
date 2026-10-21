from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_list_asset_card_data_item import ApiListAssetCardDataItem


T = TypeVar("T", bound="ApiListAssetCard")


@_attrs_define
class ApiListAssetCard:
    """List envelope: `{ ok, generated_at, count, data: [...] }`.

    Attributes:
        count (int): Number of items in `data`.
        data (list[ApiListAssetCardDataItem]):
        generated_at (str): RFC3339 (UTC, millisecond, `Z`) build time of this response.
        ok (bool): Always `true` on a 2xx; errors use the `{error, message}` envelope instead.
        history_start (None | str | Unset): Time-series lists only (`/v1/assets/{symbol}/history`): RFC3339 of the
            earliest snapshot Pegana has stored for the asset. Nothing exists before
            it, so an empty or short window ending earlier is a data floor, not an
            absence of events. Omitted elsewhere.
    """

    count: int
    data: list[ApiListAssetCardDataItem]
    generated_at: str
    ok: bool
    history_start: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        count = self.count

        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        generated_at = self.generated_at

        ok = self.ok

        history_start: None | str | Unset
        if isinstance(self.history_start, Unset):
            history_start = UNSET
        else:
            history_start = self.history_start

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "count": count,
                "data": data,
                "generated_at": generated_at,
                "ok": ok,
            }
        )
        if history_start is not UNSET:
            field_dict["history_start"] = history_start

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_list_asset_card_data_item import ApiListAssetCardDataItem

        d = dict(src_dict)
        count = d.pop("count")

        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = ApiListAssetCardDataItem.from_dict(data_item_data)

            data.append(data_item)

        generated_at = d.pop("generated_at")

        ok = d.pop("ok")

        def _parse_history_start(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        history_start = _parse_history_start(d.pop("history_start", UNSET))

        api_list_asset_card = cls(
            count=count,
            data=data,
            generated_at=generated_at,
            ok=ok,
            history_start=history_start,
        )

        api_list_asset_card.additional_properties = d
        return api_list_asset_card

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
