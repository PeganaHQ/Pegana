from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="WebhookKeysResponse")


@_attrs_define
class WebhookKeysResponse:
    """
    Attributes:
        pubkeys_b64 (list[str]): Base64-encoded Ed25519 public keys currently signing outbound
            webhooks. Index 0 is the **primary** (every new delivery is
            signed with this); index 1 (when present) is the **secondary**,
            active only during a rotation window. Receivers should trust
            ANY of the listed keys when verifying `x-pegana-signature`.
        recheck_after (datetime.datetime): Hint to refresh weekly — during a rotation this list flips
            from `[A]` → `[A, B]` → `[B]` over the rotation window. Polling
            at least once between deploys is enough to follow it.
    """

    pubkeys_b64: list[str]
    recheck_after: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        pubkeys_b64 = self.pubkeys_b64

        recheck_after = self.recheck_after.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "pubkeys_b64": pubkeys_b64,
                "recheck_after": recheck_after,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        pubkeys_b64 = cast(list[str], d.pop("pubkeys_b64"))

        recheck_after = datetime.datetime.fromisoformat(d.pop("recheck_after"))

        webhook_keys_response = cls(
            pubkeys_b64=pubkeys_b64,
            recheck_after=recheck_after,
        )

        webhook_keys_response.additional_properties = d
        return webhook_keys_response

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
