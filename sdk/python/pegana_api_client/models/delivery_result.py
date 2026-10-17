from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="DeliveryResult")



@_attrs_define
class DeliveryResult:
    """ Result of a single-shot delivery attempt. Returned as JSON to the
    caller so the operator can see exactly what happened.

        Attributes:
            delivery_id (str): Fresh per attempt — correlate with receiver-side logs.
            elapsed_ms (int): Wall-clock latency from request build to response received.
            event_id (str): Stable id mirroring the body's `alert_id` (or a fresh UUID for
                test-send synthetic events).
            error (None | str | Unset): `Some(error)` when the delivery did not return 2xx OR the
                request layer failed before sending.
            http_status (int | None | Unset): HTTP status from the receiver. `None` if the request failed
                before getting a response (DNS, timeout, TLS, SSRF guard).
     """

    delivery_id: str
    elapsed_ms: int
    event_id: str
    error: None | str | Unset = UNSET
    http_status: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        delivery_id = self.delivery_id

        elapsed_ms = self.elapsed_ms

        event_id = self.event_id

        error: None | str | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        else:
            error = self.error

        http_status: int | None | Unset
        if isinstance(self.http_status, Unset):
            http_status = UNSET
        else:
            http_status = self.http_status


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "delivery_id": delivery_id,
            "elapsed_ms": elapsed_ms,
            "event_id": event_id,
        })
        if error is not UNSET:
            field_dict["error"] = error
        if http_status is not UNSET:
            field_dict["http_status"] = http_status

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        delivery_id = d.pop("delivery_id")

        elapsed_ms = d.pop("elapsed_ms")

        event_id = d.pop("event_id")

        def _parse_error(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        error = _parse_error(d.pop("error", UNSET))


        def _parse_http_status(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        http_status = _parse_http_status(d.pop("http_status", UNSET))


        delivery_result = cls(
            delivery_id=delivery_id,
            elapsed_ms=elapsed_ms,
            event_id=event_id,
            error=error,
            http_status=http_status,
        )


        delivery_result.additional_properties = d
        return delivery_result

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
