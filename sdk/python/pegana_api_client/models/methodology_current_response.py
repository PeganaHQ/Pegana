from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="MethodologyCurrentResponse")


@_attrs_define
class MethodologyCurrentResponse:
    """Public methodology lifecycle pointer.

    `version`, `status`, and `fix_url` are the original (v1) shape — every
    current consumer (web/app/api/methodology/route.ts type-checks only
    `version`+`status`) is forward-compatible with the additive fields below.

        Attributes:
            status (str): Lifecycle status from `methodology_versions.status` enum:
                `active | deprecated | broken`.
            version (str): Semver version of the currently-active methodology crate.
            fix_url (None | str | Unset): Only populated when status = `broken`. Points at the `#lifecycle`
                section of /methodology, which renders the broken-version banner.
            git_tag (None | str | Unset): Immutable git release tag, e.g. `methodology-v0.1.0`. Always present
                when the version table is populated; omitted only on an un-migrated DB.
            released_at (None | str | Unset): RFC3339 timestamp this version was released. The honest analogue of the
                often-requested "adopted_at" — there is no separate adoption column;
                release == adoption in this lifecycle (ADR-0003).
            status_reason (None | str | Unset): Operator note attached to a `deprecated`/`broken` transition, if any.
            superseded_by (None | str | Unset): Set when this version has been superseded by a newer one.
    """

    status: str
    version: str
    fix_url: None | str | Unset = UNSET
    git_tag: None | str | Unset = UNSET
    released_at: None | str | Unset = UNSET
    status_reason: None | str | Unset = UNSET
    superseded_by: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status

        version = self.version

        fix_url: None | str | Unset
        if isinstance(self.fix_url, Unset):
            fix_url = UNSET
        else:
            fix_url = self.fix_url

        git_tag: None | str | Unset
        if isinstance(self.git_tag, Unset):
            git_tag = UNSET
        else:
            git_tag = self.git_tag

        released_at: None | str | Unset
        if isinstance(self.released_at, Unset):
            released_at = UNSET
        else:
            released_at = self.released_at

        status_reason: None | str | Unset
        if isinstance(self.status_reason, Unset):
            status_reason = UNSET
        else:
            status_reason = self.status_reason

        superseded_by: None | str | Unset
        if isinstance(self.superseded_by, Unset):
            superseded_by = UNSET
        else:
            superseded_by = self.superseded_by

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "version": version,
            }
        )
        if fix_url is not UNSET:
            field_dict["fix_url"] = fix_url
        if git_tag is not UNSET:
            field_dict["git_tag"] = git_tag
        if released_at is not UNSET:
            field_dict["released_at"] = released_at
        if status_reason is not UNSET:
            field_dict["status_reason"] = status_reason
        if superseded_by is not UNSET:
            field_dict["superseded_by"] = superseded_by

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        status = d.pop("status")

        version = d.pop("version")

        def _parse_fix_url(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        fix_url = _parse_fix_url(d.pop("fix_url", UNSET))

        def _parse_git_tag(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        git_tag = _parse_git_tag(d.pop("git_tag", UNSET))

        def _parse_released_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        released_at = _parse_released_at(d.pop("released_at", UNSET))

        def _parse_status_reason(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        status_reason = _parse_status_reason(d.pop("status_reason", UNSET))

        def _parse_superseded_by(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        superseded_by = _parse_superseded_by(d.pop("superseded_by", UNSET))

        methodology_current_response = cls(
            status=status,
            version=version,
            fix_url=fix_url,
            git_tag=git_tag,
            released_at=released_at,
            status_reason=status_reason,
            superseded_by=superseded_by,
        )

        methodology_current_response.additional_properties = d
        return methodology_current_response

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
