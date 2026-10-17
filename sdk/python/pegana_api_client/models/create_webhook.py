from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="CreateWebhook")



@_attrs_define
class CreateWebhook:
    """ 
        Attributes:
            asset (str):
            threshold_bps (int):
            url (str):
            channel_type (None | str | Unset): Optional. When omitted, the server detects it from the URL host
                (`discord.com` → discord, `hooks.slack.com` → slack, else generic).
     """

    asset: str
    threshold_bps: int
    url: str
    channel_type: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        asset = self.asset

        threshold_bps = self.threshold_bps

        url = self.url

        channel_type: None | str | Unset
        if isinstance(self.channel_type, Unset):
            channel_type = UNSET
        else:
            channel_type = self.channel_type


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "asset": asset,
            "threshold_bps": threshold_bps,
            "url": url,
        })
        if channel_type is not UNSET:
            field_dict["channel_type"] = channel_type

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        asset = d.pop("asset")

        threshold_bps = d.pop("threshold_bps")

        url = d.pop("url")

        def _parse_channel_type(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        channel_type = _parse_channel_type(d.pop("channel_type", UNSET))


        create_webhook = cls(
            asset=asset,
            threshold_bps=threshold_bps,
            url=url,
            channel_type=channel_type,
        )


        create_webhook.additional_properties = d
        return create_webhook

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
