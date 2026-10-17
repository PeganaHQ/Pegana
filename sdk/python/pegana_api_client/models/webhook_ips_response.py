from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime






T = TypeVar("T", bound="WebhookIpsResponse")



@_attrs_define
class WebhookIpsResponse:
    """ 
        Attributes:
            ips (list[str]): IPv4 / IPv6 addresses Pegana POSTs from when delivering webhooks.
                Subscribers running zero-trust ingress can allowlist these.
            recheck_after (datetime.datetime): Hint to refresh this list weekly — IPs can change without notice
                during infrastructure migrations.
     """

    ips: list[str]
    recheck_after: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        ips = self.ips



        recheck_after = self.recheck_after.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "ips": ips,
            "recheck_after": recheck_after,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ips = cast(list[str], d.pop("ips"))


        recheck_after = datetime.datetime.fromisoformat(d.pop("recheck_after"))




        webhook_ips_response = cls(
            ips=ips,
            recheck_after=recheck_after,
        )


        webhook_ips_response.additional_properties = d
        return webhook_ips_response

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
