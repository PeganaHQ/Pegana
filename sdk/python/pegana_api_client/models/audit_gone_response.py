from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="AuditGoneResponse")


@_attrs_define
class AuditGoneResponse:
    """410 body for `GET /v1/audit/{alert_id}` — receipt persistence failed
    permanently (ADR-0006 dead-letter terminal); the receipt will never land.

        Attributes:
            alert_dispatched_at (datetime.datetime): When the alert was dispatched (the dead-letter `queued_at`).
            alert_id (str):
            evidence_status (str): Always `"failed_permanent"`.
            status (str): Always `"persistence_failed"`.
            last_error (None | str | Unset): Last persistence error recorded, if any.
    """

    alert_dispatched_at: datetime.datetime
    alert_id: str
    evidence_status: str
    status: str
    last_error: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        alert_dispatched_at = self.alert_dispatched_at.isoformat()

        alert_id = self.alert_id

        evidence_status = self.evidence_status

        status = self.status

        last_error: None | str | Unset
        if isinstance(self.last_error, Unset):
            last_error = UNSET
        else:
            last_error = self.last_error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "alert_dispatched_at": alert_dispatched_at,
                "alert_id": alert_id,
                "evidence_status": evidence_status,
                "status": status,
            }
        )
        if last_error is not UNSET:
            field_dict["last_error"] = last_error

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        alert_dispatched_at = datetime.datetime.fromisoformat(
            d.pop("alert_dispatched_at")
        )

        alert_id = d.pop("alert_id")

        evidence_status = d.pop("evidence_status")

        status = d.pop("status")

        def _parse_last_error(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        last_error = _parse_last_error(d.pop("last_error", UNSET))

        audit_gone_response = cls(
            alert_dispatched_at=alert_dispatched_at,
            alert_id=alert_id,
            evidence_status=evidence_status,
            status=status,
            last_error=last_error,
        )

        audit_gone_response.additional_properties = d
        return audit_gone_response

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
