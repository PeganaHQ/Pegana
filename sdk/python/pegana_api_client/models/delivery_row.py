from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
from uuid import UUID
import datetime






T = TypeVar("T", bound="DeliveryRow")



@_attrs_define
class DeliveryRow:
    """ 
        Attributes:
            alert_id (UUID):
            attempt (int):
            attempted_at (datetime.datetime):
            elapsed_ms (int):
            is_test (bool):
            error (None | str | Unset):
            http_status (int | None | Unset): `null` when the request never produced an HTTP response
                (DNS, TLS, timeout, SSRF guard rejection).
     """

    alert_id: UUID
    attempt: int
    attempted_at: datetime.datetime
    elapsed_ms: int
    is_test: bool
    error: None | str | Unset = UNSET
    http_status: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        alert_id = str(self.alert_id)

        attempt = self.attempt

        attempted_at = self.attempted_at.isoformat()

        elapsed_ms = self.elapsed_ms

        is_test = self.is_test

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
            "alert_id": alert_id,
            "attempt": attempt,
            "attempted_at": attempted_at,
            "elapsed_ms": elapsed_ms,
            "is_test": is_test,
        })
        if error is not UNSET:
            field_dict["error"] = error
        if http_status is not UNSET:
            field_dict["http_status"] = http_status

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        alert_id = UUID(d.pop("alert_id"))




        attempt = d.pop("attempt")

        attempted_at = datetime.datetime.fromisoformat(d.pop("attempted_at"))




        elapsed_ms = d.pop("elapsed_ms")

        is_test = d.pop("is_test")

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


        delivery_row = cls(
            alert_id=alert_id,
            attempt=attempt,
            attempted_at=attempted_at,
            elapsed_ms=elapsed_ms,
            is_test=is_test,
            error=error,
            http_status=http_status,
        )


        delivery_row.additional_properties = d
        return delivery_row

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
