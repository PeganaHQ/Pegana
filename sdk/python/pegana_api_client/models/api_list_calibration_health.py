from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_list_calibration_health_data_item import (
        ApiListCalibrationHealthDataItem,
    )


T = TypeVar("T", bound="ApiListCalibrationHealth")


@_attrs_define
class ApiListCalibrationHealth:
    """List envelope: `{ ok, generated_at, count, data: [...] }`.

    Attributes:
        count (int): Number of items in `data`.
        data (list[ApiListCalibrationHealthDataItem]):
        generated_at (str): RFC3339 (UTC, millisecond, `Z`) build time of this response.
        ok (bool): Always `true` on a 2xx; errors use the `{error, message}` envelope instead.
        history_start (None | str | Unset): Time-series lists only (`/v1/assets/{symbol}/history`): RFC3339 of the
            earliest snapshot Pegana has stored for the asset. Nothing exists before
            it, so an empty or short window ending earlier is a data floor, not an
            absence of events. Omitted elsewhere.
        next_from (None | str | Unset): Present only when `truncated` is `true`: the EFFECTIVE lower bound of
            this window (RFC3339, microsecond, `Z`), i.e. the `from` the request
            sent or the default it got (now minus 24h). Pass it back as `from`
            with `next_to`: the default `from` is `Utc::now() - 24h`, not
            `to - 24h`, so paging without `from` keeps `from` at now-24h and, once
            `next_to` is older than 24h, the request returns 400 `invalid_range`.
        next_to (None | str | Unset): Present only when `truncated` is `true`: RFC3339 (microsecond, `Z`)
            instant just before the oldest row returned. Repeat the request with
            `from=<next_from>&to=<next_to>` (same `bucket`, `limit`) to get the
            next, older page; no row is skipped or repeated.
        truncated (bool | None | Unset): Time-series lists only (`/v1/assets/{symbol}/history`): `true` when the
            window holds more rows than `limit`, so `data` stops before `from`.
            Always present there (`false` when the window fit). Omitted elsewhere.
    """

    count: int
    data: list[ApiListCalibrationHealthDataItem]
    generated_at: str
    ok: bool
    history_start: None | str | Unset = UNSET
    next_from: None | str | Unset = UNSET
    next_to: None | str | Unset = UNSET
    truncated: bool | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        count = self.count

        data = []
        for data_item_data in self.data:
            data_item = data_item_data.to_dict()
            data.append(data_item)

        generated_at = self.generated_at

        ok = self.ok

        history_start: None | str | Unset
        if isinstance(self.history_start, Unset):
            history_start = UNSET
        else:
            history_start = self.history_start

        next_from: None | str | Unset
        if isinstance(self.next_from, Unset):
            next_from = UNSET
        else:
            next_from = self.next_from

        next_to: None | str | Unset
        if isinstance(self.next_to, Unset):
            next_to = UNSET
        else:
            next_to = self.next_to

        truncated: bool | None | Unset
        if isinstance(self.truncated, Unset):
            truncated = UNSET
        else:
            truncated = self.truncated

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "count": count,
                "data": data,
                "generated_at": generated_at,
                "ok": ok,
            }
        )
        if history_start is not UNSET:
            field_dict["history_start"] = history_start
        if next_from is not UNSET:
            field_dict["next_from"] = next_from
        if next_to is not UNSET:
            field_dict["next_to"] = next_to
        if truncated is not UNSET:
            field_dict["truncated"] = truncated

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_list_calibration_health_data_item import (
            ApiListCalibrationHealthDataItem,
        )

        d = dict(src_dict)
        count = d.pop("count")

        data = []
        _data = d.pop("data")
        for data_item_data in _data:
            data_item = ApiListCalibrationHealthDataItem.from_dict(data_item_data)

            data.append(data_item)

        generated_at = d.pop("generated_at")

        ok = d.pop("ok")

        def _parse_history_start(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        history_start = _parse_history_start(d.pop("history_start", UNSET))

        def _parse_next_from(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        next_from = _parse_next_from(d.pop("next_from", UNSET))

        def _parse_next_to(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        next_to = _parse_next_to(d.pop("next_to", UNSET))

        def _parse_truncated(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        truncated = _parse_truncated(d.pop("truncated", UNSET))

        api_list_calibration_health = cls(
            count=count,
            data=data,
            generated_at=generated_at,
            ok=ok,
            history_start=history_start,
            next_from=next_from,
            next_to=next_to,
            truncated=truncated,
        )

        api_list_calibration_health.additional_properties = d
        return api_list_calibration_health

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
