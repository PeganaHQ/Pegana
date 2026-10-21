from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.audit_alert import AuditAlert
    from ..models.audit_evidence import AuditEvidence


T = TypeVar("T", bound="AuditDetailResponse")


@_attrs_define
class AuditDetailResponse:
    """Receipt envelope returned by `GET /v1/audit/{alert_id}` with a 200 (the
    `alert_evidence` row exists). The runtime body is assembled via `json!` for
    LEFT-JOIN flexibility; these structs mirror it field-for-field so
    `/openapi.json` documents the REAL shape instead of two opaque objects. Kept
    in lockstep with the `json!` body manually; the 202/410 responses use a
    different shape (see the endpoint's other documented responses).

        Attributes:
            alert (AuditAlert): The `alert` object inside a 200 receipt body (`GET /v1/audit/{alert_id}`).
                Decimal money fields are JSON strings (preserves precision).
            evidence (AuditEvidence): The `evidence` object inside a 200 receipt body; the frozen inputs and
                methodology pin that make the alert independently verifiable.
            evidence_status (str): Always `"ready"` on a 200.
    """

    alert: AuditAlert
    evidence: AuditEvidence
    evidence_status: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        alert = self.alert.to_dict()

        evidence = self.evidence.to_dict()

        evidence_status = self.evidence_status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "alert": alert,
                "evidence": evidence,
                "evidence_status": evidence_status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.audit_alert import AuditAlert
        from ..models.audit_evidence import AuditEvidence

        d = dict(src_dict)
        alert = AuditAlert.from_dict(d.pop("alert"))

        evidence = AuditEvidence.from_dict(d.pop("evidence"))

        evidence_status = d.pop("evidence_status")

        audit_detail_response = cls(
            alert=alert,
            evidence=evidence,
            evidence_status=evidence_status,
        )

        audit_detail_response.additional_properties = d
        return audit_detail_response

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
