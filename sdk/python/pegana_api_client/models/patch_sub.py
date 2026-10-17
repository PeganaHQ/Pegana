from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="PatchSub")



@_attrs_define
class PatchSub:
    """ 
        Attributes:
            is_active (bool | None | Unset):
            threshold_bps (int | None | Unset):
     """

    is_active: bool | None | Unset = UNSET
    threshold_bps: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        is_active: bool | None | Unset
        if isinstance(self.is_active, Unset):
            is_active = UNSET
        else:
            is_active = self.is_active

        threshold_bps: int | None | Unset
        if isinstance(self.threshold_bps, Unset):
            threshold_bps = UNSET
        else:
            threshold_bps = self.threshold_bps


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if is_active is not UNSET:
            field_dict["is_active"] = is_active
        if threshold_bps is not UNSET:
            field_dict["threshold_bps"] = threshold_bps

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        def _parse_is_active(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        is_active = _parse_is_active(d.pop("is_active", UNSET))


        def _parse_threshold_bps(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        threshold_bps = _parse_threshold_bps(d.pop("threshold_bps", UNSET))


        patch_sub = cls(
            is_active=is_active,
            threshold_bps=threshold_bps,
        )


        patch_sub.additional_properties = d
        return patch_sub

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
