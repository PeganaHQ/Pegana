from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.source_freshness import SourceFreshness


T = TypeVar("T", bound="ReadyResponse")


@_attrs_define
class ReadyResponse:
    """
    Attributes:
        db (bool): SELECT 1 on Postgres succeeded.
        redis (bool): PING on Redis returned PONG.
        sources (SourceFreshness):
        status (str): "ready" if all downstream deps are healthy; "not_ready" otherwise.
        last_snapshot_age_secs (int | None | Unset): Seconds since the most recent `discount_snapshots.ts`. `None` if no
            snapshots exist yet.
    """

    db: bool
    redis: bool
    sources: SourceFreshness
    status: str
    last_snapshot_age_secs: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        db = self.db

        redis = self.redis

        sources = self.sources.to_dict()

        status = self.status

        last_snapshot_age_secs: int | None | Unset
        if isinstance(self.last_snapshot_age_secs, Unset):
            last_snapshot_age_secs = UNSET
        else:
            last_snapshot_age_secs = self.last_snapshot_age_secs

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "db": db,
                "redis": redis,
                "sources": sources,
                "status": status,
            }
        )
        if last_snapshot_age_secs is not UNSET:
            field_dict["last_snapshot_age_secs"] = last_snapshot_age_secs

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.source_freshness import SourceFreshness

        d = dict(src_dict)
        db = d.pop("db")

        redis = d.pop("redis")

        sources = SourceFreshness.from_dict(d.pop("sources"))

        status = d.pop("status")

        def _parse_last_snapshot_age_secs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        last_snapshot_age_secs = _parse_last_snapshot_age_secs(
            d.pop("last_snapshot_age_secs", UNSET)
        )

        ready_response = cls(
            db=db,
            redis=redis,
            sources=sources,
            status=status,
            last_snapshot_age_secs=last_snapshot_age_secs,
        )

        ready_response.additional_properties = d
        return ready_response

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
