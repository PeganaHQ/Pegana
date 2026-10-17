from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset







T = TypeVar("T", bound="SimulateByProtocol")



@_attrs_define
class SimulateByProtocol:
    """ 
        Attributes:
            liquidatable_usd (str):
            positions (str):
            protocol (str):
     """

    liquidatable_usd: str
    positions: str
    protocol: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        liquidatable_usd = self.liquidatable_usd

        positions = self.positions

        protocol = self.protocol


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "liquidatable_usd": liquidatable_usd,
            "positions": positions,
            "protocol": protocol,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        liquidatable_usd = d.pop("liquidatable_usd")

        positions = d.pop("positions")

        protocol = d.pop("protocol")

        simulate_by_protocol = cls(
            liquidatable_usd=liquidatable_usd,
            positions=positions,
            protocol=protocol,
        )


        simulate_by_protocol.additional_properties = d
        return simulate_by_protocol

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
