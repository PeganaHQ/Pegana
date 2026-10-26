from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="DeliveryHealth")


@_attrs_define
class DeliveryHealth:
    """Delivery-pipeline health rollup. Surfaced so the dashboard can show a
    degraded badge when notifications are silently failing; historically
    MarkdownV2 escape bugs caused alert_deliveries.status='failed' rows to
    pile up without any user-visible signal, breaking trust.

        Attributes:
            failed_24h (int):
            sent_24h (int):
            last_failure_error (None | str | Unset): Most recent failure error message (truncated to 200 chars) if any
                failures landed in the last 24h. Useful for ops without forcing the
                frontend to query a separate endpoint.
    """

    failed_24h: int
    sent_24h: int
    last_failure_error: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        failed_24h = self.failed_24h

        sent_24h = self.sent_24h

        last_failure_error: None | str | Unset
        if isinstance(self.last_failure_error, Unset):
            last_failure_error = UNSET
        else:
            last_failure_error = self.last_failure_error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "failed_24h": failed_24h,
                "sent_24h": sent_24h,
            }
        )
        if last_failure_error is not UNSET:
            field_dict["last_failure_error"] = last_failure_error

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        failed_24h = d.pop("failed_24h")

        sent_24h = d.pop("sent_24h")

        def _parse_last_failure_error(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        last_failure_error = _parse_last_failure_error(
            d.pop("last_failure_error", UNSET)
        )

        delivery_health = cls(
            failed_24h=failed_24h,
            sent_24h=sent_24h,
            last_failure_error=last_failure_error,
        )

        delivery_health.additional_properties = d
        return delivery_health

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
