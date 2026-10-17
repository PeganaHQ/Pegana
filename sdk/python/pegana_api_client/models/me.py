from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="Me")



@_attrs_define
class Me:
    """ 
        Attributes:
            digest_enabled (bool):
            digest_hour_utc (int):
            locale (str):
            telegram_id (int):
            username (None | str | Unset):
     """

    digest_enabled: bool
    digest_hour_utc: int
    locale: str
    telegram_id: int
    username: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        digest_enabled = self.digest_enabled

        digest_hour_utc = self.digest_hour_utc

        locale = self.locale

        telegram_id = self.telegram_id

        username: None | str | Unset
        if isinstance(self.username, Unset):
            username = UNSET
        else:
            username = self.username


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "digest_enabled": digest_enabled,
            "digest_hour_utc": digest_hour_utc,
            "locale": locale,
            "telegram_id": telegram_id,
        })
        if username is not UNSET:
            field_dict["username"] = username

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        digest_enabled = d.pop("digest_enabled")

        digest_hour_utc = d.pop("digest_hour_utc")

        locale = d.pop("locale")

        telegram_id = d.pop("telegram_id")

        def _parse_username(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        username = _parse_username(d.pop("username", UNSET))


        me = cls(
            digest_enabled=digest_enabled,
            digest_hour_utc=digest_hour_utc,
            locale=locale,
            telegram_id=telegram_id,
            username=username,
        )


        me.additional_properties = d
        return me

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
