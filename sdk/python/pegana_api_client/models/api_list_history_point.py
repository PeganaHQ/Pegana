from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.api_list_history_point_data_item import ApiListHistoryPointDataItem





T = TypeVar("T", bound="ApiListHistoryPoint")



@_attrs_define
class ApiListHistoryPoint:
    """ List envelope: `{ ok, generated_at, count, data: [...] }`.

        Attributes:
            count (int): Number of items in `data`.
            data (list[ApiListHistoryPointDataItem]):
            generated_at (str): RFC3339 (UTC, millisecond, `Z`) build time of this response.
            ok (bool): Always `true` on a 2xx; errors use the `{error, message}` envelope instead.
     """

    count: int
    data: list[ApiListHistoryPointDataItem]
    generated_at: str
    ok: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.api_list_history_point_data_item import ApiListHistoryPointDataItem
        count = self.count

        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)



        generated_at = self.generated_at

        ok = self.ok


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "count": count,
            "data": data,
            "generated_at": generated_at,
            "ok": ok,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_list_history_point_data_item import ApiListHistoryPointDataItem
        d = dict(src_dict)
        count = d.pop("count")

        data = []
        _data = d.pop("data")
        for data_item_data in (_data):
            data_item = ApiListHistoryPointDataItem.from_dict(data_item_data)



            data.append(data_item)


        generated_at = d.pop("generated_at")

        ok = d.pop("ok")

        api_list_history_point = cls(
            count=count,
            data=data,
            generated_at=generated_at,
            ok=ok,
        )


        api_list_history_point.additional_properties = d
        return api_list_history_point

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
