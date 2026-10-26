from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="AuditEvidence")


@_attrs_define
class AuditEvidence:
    """The `evidence` object inside a 200 receipt body; the frozen inputs and
    methodology pin that make the alert independently verifiable.

        Attributes:
            assets_toml_sha256 (str):
            computed (Any): Verbatim computed intermediates.
            created_at (datetime.datetime):
            has_replay_artifact (bool):
            inputs_frozen (Any): Verbatim frozen inputs snapshot (shape depends on methodology version).
            methodology_version (str):
            receipt_sha256 (str):
            commit_status (None | str | Unset): `not_applicable` | `pending` | `committed` | `retry_exhausted` |
                `wallet_drained`.
            methodology_git_sha (None | str | Unset):
            onchain_tx_sig (None | str | Unset):
    """

    assets_toml_sha256: str
    computed: Any
    created_at: datetime.datetime
    has_replay_artifact: bool
    inputs_frozen: Any
    methodology_version: str
    receipt_sha256: str
    commit_status: None | str | Unset = UNSET
    methodology_git_sha: None | str | Unset = UNSET
    onchain_tx_sig: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        assets_toml_sha256 = self.assets_toml_sha256

        computed = self.computed

        created_at = self.created_at.isoformat()

        has_replay_artifact = self.has_replay_artifact

        inputs_frozen = self.inputs_frozen

        methodology_version = self.methodology_version

        receipt_sha256 = self.receipt_sha256

        commit_status: None | str | Unset
        if isinstance(self.commit_status, Unset):
            commit_status = UNSET
        else:
            commit_status = self.commit_status

        methodology_git_sha: None | str | Unset
        if isinstance(self.methodology_git_sha, Unset):
            methodology_git_sha = UNSET
        else:
            methodology_git_sha = self.methodology_git_sha

        onchain_tx_sig: None | str | Unset
        if isinstance(self.onchain_tx_sig, Unset):
            onchain_tx_sig = UNSET
        else:
            onchain_tx_sig = self.onchain_tx_sig

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "assets_toml_sha256": assets_toml_sha256,
                "computed": computed,
                "created_at": created_at,
                "has_replay_artifact": has_replay_artifact,
                "inputs_frozen": inputs_frozen,
                "methodology_version": methodology_version,
                "receipt_sha256": receipt_sha256,
            }
        )
        if commit_status is not UNSET:
            field_dict["commit_status"] = commit_status
        if methodology_git_sha is not UNSET:
            field_dict["methodology_git_sha"] = methodology_git_sha
        if onchain_tx_sig is not UNSET:
            field_dict["onchain_tx_sig"] = onchain_tx_sig

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        assets_toml_sha256 = d.pop("assets_toml_sha256")

        computed = d.pop("computed")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        has_replay_artifact = d.pop("has_replay_artifact")

        inputs_frozen = d.pop("inputs_frozen")

        methodology_version = d.pop("methodology_version")

        receipt_sha256 = d.pop("receipt_sha256")

        def _parse_commit_status(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        commit_status = _parse_commit_status(d.pop("commit_status", UNSET))

        def _parse_methodology_git_sha(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        methodology_git_sha = _parse_methodology_git_sha(
            d.pop("methodology_git_sha", UNSET)
        )

        def _parse_onchain_tx_sig(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        onchain_tx_sig = _parse_onchain_tx_sig(d.pop("onchain_tx_sig", UNSET))

        audit_evidence = cls(
            assets_toml_sha256=assets_toml_sha256,
            computed=computed,
            created_at=created_at,
            has_replay_artifact=has_replay_artifact,
            inputs_frozen=inputs_frozen,
            methodology_version=methodology_version,
            receipt_sha256=receipt_sha256,
            commit_status=commit_status,
            methodology_git_sha=methodology_git_sha,
            onchain_tx_sig=onchain_tx_sig,
        )

        audit_evidence.additional_properties = d
        return audit_evidence

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
