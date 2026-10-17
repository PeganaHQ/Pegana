from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime






T = TypeVar("T", bound="AuditPendingResponse")



@_attrs_define
class AuditPendingResponse:
    """ 202 body for `GET /v1/audit/{alert_id}` — receipt persistence is still
    retrying (ADR-0006). Poll again after `retry_after_seconds`.

        Attributes:
            alert_dispatched_at (datetime.datetime): When the alert was dispatched (the dead-letter `queued_at`).
            alert_id (str):
            evidence_status (str): Always `"pending"`.
            retry_after_seconds (int): Suggested back-off before re-polling.
            status (str): Always `"pending"`.
     """

    alert_dispatched_at: datetime.datetime
    alert_id: str
    evidence_status: str
    retry_after_seconds: int
    status: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        alert_dispatched_at = self.alert_dispatched_at.isoformat()

        alert_id = self.alert_id

        evidence_status = self.evidence_status

        retry_after_seconds = self.retry_after_seconds

        status = self.status


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "alert_dispatched_at": alert_dispatched_at,
            "alert_id": alert_id,
            "evidence_status": evidence_status,
            "retry_after_seconds": retry_after_seconds,
            "status": status,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        alert_dispatched_at = datetime.datetime.fromisoformat(d.pop("alert_dispatched_at"))




        alert_id = d.pop("alert_id")

        evidence_status = d.pop("evidence_status")

        retry_after_seconds = d.pop("retry_after_seconds")

        status = d.pop("status")

        audit_pending_response = cls(
            alert_dispatched_at=alert_dispatched_at,
            alert_id=alert_id,
            evidence_status=evidence_status,
            retry_after_seconds=retry_after_seconds,
            status=status,
        )


        audit_pending_response.additional_properties = d
        return audit_pending_response

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
