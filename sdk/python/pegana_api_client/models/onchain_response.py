from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="OnchainResponse")


@_attrs_define
class OnchainResponse:
    """On-chain commit pointer.

    Attributes:
        commit_status (str): Always `"committed"` on a 200 — present so a caller can branch on the
            same `commit_status` vocabulary the 404 body uses (ADR-0004).
        explorer_url (str):
        tx_sig (str):
    """

    commit_status: str
    explorer_url: str
    tx_sig: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        commit_status = self.commit_status

        explorer_url = self.explorer_url

        tx_sig = self.tx_sig

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "commit_status": commit_status,
                "explorer_url": explorer_url,
                "tx_sig": tx_sig,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        commit_status = d.pop("commit_status")

        explorer_url = d.pop("explorer_url")

        tx_sig = d.pop("tx_sig")

        onchain_response = cls(
            commit_status=commit_status,
            explorer_url=explorer_url,
            tx_sig=tx_sig,
        )

        onchain_response.additional_properties = d
        return onchain_response

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
