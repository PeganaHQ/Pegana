from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="PatchWebhook")



@_attrs_define
class PatchWebhook:
    """ 
        Attributes:
            channel_type (None | str | Unset): Override the channel flavor (`"generic"`|`"discord"`|`"slack"`) when
                auto-detection guessed wrong. Omit to leave unchanged.
            is_active (bool | None | Unset): Toggle active state without deleting the row. Useful for
                pause-then-resume during receiver maintenance.
            threshold_bps (int | None | Unset): Replace the alert threshold (1..10000 bps). Omit to leave
                unchanged.
            url (None | str | Unset): Replace the destination URL. SSRF + length guards re-applied;
                omit to leave unchanged.
     """

    channel_type: None | str | Unset = UNSET
    is_active: bool | None | Unset = UNSET
    threshold_bps: int | None | Unset = UNSET
    url: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        channel_type: None | str | Unset
        if isinstance(self.channel_type, Unset):
            channel_type = UNSET
        else:
            channel_type = self.channel_type

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

        url: None | str | Unset
        if isinstance(self.url, Unset):
            url = UNSET
        else:
            url = self.url


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if channel_type is not UNSET:
            field_dict["channel_type"] = channel_type
        if is_active is not UNSET:
            field_dict["is_active"] = is_active
        if threshold_bps is not UNSET:
            field_dict["threshold_bps"] = threshold_bps
        if url is not UNSET:
            field_dict["url"] = url

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        def _parse_channel_type(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        channel_type = _parse_channel_type(d.pop("channel_type", UNSET))


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


        def _parse_url(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        url = _parse_url(d.pop("url", UNSET))


        patch_webhook = cls(
            channel_type=channel_type,
            is_active=is_active,
            threshold_bps=threshold_bps,
            url=url,
        )


        patch_webhook.additional_properties = d
        return patch_webhook

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
