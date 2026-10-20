from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="CascadeRung")


@_attrs_define
class CascadeRung:
    """One rung of the depeg-cascade at a preset shock — the compact form carried by
    the `/loop-exposure` endpoint and the tokens.xyz feed's `systemic` block so a
    consumer gets the whole escalation ($0 → $Nm as the depeg deepens) in one read.

        Attributes:
            liquidatable_usd (str): Collateral (USD) whose bands cross their liquidation threshold at this shock.
            positions (str): Bucketed range of affected positions (ADR-0036 inv.8 — never a raw count).
            shock_bps (int):
    """

    liquidatable_usd: str
    positions: str
    shock_bps: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        liquidatable_usd = self.liquidatable_usd

        positions = self.positions

        shock_bps = self.shock_bps

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "liquidatable_usd": liquidatable_usd,
                "positions": positions,
                "shock_bps": shock_bps,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        liquidatable_usd = d.pop("liquidatable_usd")

        positions = d.pop("positions")

        shock_bps = d.pop("shock_bps")

        cascade_rung = cls(
            liquidatable_usd=liquidatable_usd,
            positions=positions,
            shock_bps=shock_bps,
        )

        cascade_rung.additional_properties = d
        return cascade_rung

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
