from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from uuid import UUID






T = TypeVar("T", bound="Webhook")



@_attrs_define
class Webhook:
    """ 
        Attributes:
            asset (str):
            channel_type (str): `"generic"` | `"discord"` | `"slack"`. Auto-detected from the URL on
                create when omitted; overridable via PATCH. Decides how alerts render
                (Discord embed / Slack attachment / generic signed JSON).
            id (UUID):
            is_active (bool):
            threshold_bps (int):
            url (str):
     """

    asset: str
    channel_type: str
    id: UUID
    is_active: bool
    threshold_bps: int
    url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        channel_type = self.channel_type

        id = str(self.id)

        is_active = self.is_active

        threshold_bps = self.threshold_bps

        url = self.url


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "asset": asset,
            "channel_type": channel_type,
            "id": id,
            "is_active": is_active,
            "threshold_bps": threshold_bps,
            "url": url,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        asset = d.pop("asset")

        channel_type = d.pop("channel_type")

        id = UUID(d.pop("id"))




        is_active = d.pop("is_active")

        threshold_bps = d.pop("threshold_bps")

        url = d.pop("url")

        webhook = cls(
            asset=asset,
            channel_type=channel_type,
            id=id,
            is_active=is_active,
            threshold_bps=threshold_bps,
            url=url,
        )


        webhook.additional_properties = d
        return webhook

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
