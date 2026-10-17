from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="PreferencesPatch")



@_attrs_define
class PreferencesPatch:
    """ 
        Attributes:
            digest_enabled (bool | None | Unset):
            digest_hour_utc (int | None | Unset):
            locale (None | str | Unset):
     """

    digest_enabled: bool | None | Unset = UNSET
    digest_hour_utc: int | None | Unset = UNSET
    locale: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        digest_enabled: bool | None | Unset
        if isinstance(self.digest_enabled, Unset):
            digest_enabled = UNSET
        else:
            digest_enabled = self.digest_enabled

        digest_hour_utc: int | None | Unset
        if isinstance(self.digest_hour_utc, Unset):
            digest_hour_utc = UNSET
        else:
            digest_hour_utc = self.digest_hour_utc

        locale: None | str | Unset
        if isinstance(self.locale, Unset):
            locale = UNSET
        else:
            locale = self.locale


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
        })
        if digest_enabled is not UNSET:
            field_dict["digest_enabled"] = digest_enabled
        if digest_hour_utc is not UNSET:
            field_dict["digest_hour_utc"] = digest_hour_utc
        if locale is not UNSET:
            field_dict["locale"] = locale

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        def _parse_digest_enabled(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        digest_enabled = _parse_digest_enabled(d.pop("digest_enabled", UNSET))


        def _parse_digest_hour_utc(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        digest_hour_utc = _parse_digest_hour_utc(d.pop("digest_hour_utc", UNSET))


        def _parse_locale(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        locale = _parse_locale(d.pop("locale", UNSET))


        preferences_patch = cls(
            digest_enabled=digest_enabled,
            digest_hour_utc=digest_hour_utc,
            locale=locale,
        )


        preferences_patch.additional_properties = d
        return preferences_patch

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
