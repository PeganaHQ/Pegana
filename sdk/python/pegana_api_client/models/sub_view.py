from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="SubView")



@_attrs_define
class SubView:
    """ 
        Attributes:
            asset (str):
            channel (str):
            created_at (datetime.datetime):
            id (int):
            is_active (bool):
            threshold_bps (int):
            last_fired_at (datetime.datetime | None | Unset):
     """

    asset: str
    channel: str
    created_at: datetime.datetime
    id: int
    is_active: bool
    threshold_bps: int
    last_fired_at: datetime.datetime | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        channel = self.channel

        created_at = self.created_at.isoformat()

        id = self.id

        is_active = self.is_active

        threshold_bps = self.threshold_bps

        last_fired_at: None | str | Unset
        if isinstance(self.last_fired_at, Unset):
            last_fired_at = UNSET
        elif isinstance(self.last_fired_at, datetime.datetime):
            last_fired_at = self.last_fired_at.isoformat()
        else:
            last_fired_at = self.last_fired_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "asset": asset,
            "channel": channel,
            "created_at": created_at,
            "id": id,
            "is_active": is_active,
            "threshold_bps": threshold_bps,
        })
        if last_fired_at is not UNSET:
            field_dict["last_fired_at"] = last_fired_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        asset = d.pop("asset")

        channel = d.pop("channel")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))




        id = d.pop("id")

        is_active = d.pop("is_active")

        threshold_bps = d.pop("threshold_bps")

        def _parse_last_fired_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_fired_at_type_0 = datetime.datetime.fromisoformat(data)



                return last_fired_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        last_fired_at = _parse_last_fired_at(d.pop("last_fired_at", UNSET))


        sub_view = cls(
            asset=asset,
            channel=channel,
            created_at=created_at,
            id=id,
            is_active=is_active,
            threshold_bps=threshold_bps,
            last_fired_at=last_fired_at,
        )


        sub_view.additional_properties = d
        return sub_view

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
