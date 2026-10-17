from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.simulate_by_protocol import SimulateByProtocol





T = TypeVar("T", bound="SimulateDepegResponse")



@_attrs_define
class SimulateDepegResponse:
    """ 
        Attributes:
            advisory_note (str): ADR-0036 inv.9 — advisory model estimate, not a verifiable receipt.
            asset (str):
            by_protocol (list[SimulateByProtocol]):
            coverage (str): `full` | `partial` | `unknown`. `partial` whenever risky bands were
                k-floor-dropped or dominance-suppressed (the honest ADR-0036 posture).
            liquidatable_usd (str): Collateral (USD) in bands that cross their liquidation threshold at this shock.
            loop_exposure_usd (str): Total leveraged collateral across protocols (context, from loop-exposure).
            positions (str): Bucketed range of affected positions (ADR-0036 inv.8 — never a raw count).
            shock_bps (int):
            updated_at (None | str | Unset):
     """

    advisory_note: str
    asset: str
    by_protocol: list[SimulateByProtocol]
    coverage: str
    liquidatable_usd: str
    loop_exposure_usd: str
    positions: str
    shock_bps: int
    updated_at: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.simulate_by_protocol import SimulateByProtocol
        advisory_note = self.advisory_note

        asset = self.asset

        by_protocol = []
        for by_protocol_item_data in self.by_protocol:
            by_protocol_item = by_protocol_item_data.to_dict()
            by_protocol.append(by_protocol_item)



        coverage = self.coverage

        liquidatable_usd = self.liquidatable_usd

        loop_exposure_usd = self.loop_exposure_usd

        positions = self.positions

        shock_bps = self.shock_bps

        updated_at: None | str | Unset
        if isinstance(self.updated_at, Unset):
            updated_at = UNSET
        else:
            updated_at = self.updated_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "advisory_note": advisory_note,
            "asset": asset,
            "by_protocol": by_protocol,
            "coverage": coverage,
            "liquidatable_usd": liquidatable_usd,
            "loop_exposure_usd": loop_exposure_usd,
            "positions": positions,
            "shock_bps": shock_bps,
        })
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.simulate_by_protocol import SimulateByProtocol
        d = dict(src_dict)
        advisory_note = d.pop("advisory_note")

        asset = d.pop("asset")

        by_protocol = []
        _by_protocol = d.pop("by_protocol")
        for by_protocol_item_data in (_by_protocol):
            by_protocol_item = SimulateByProtocol.from_dict(by_protocol_item_data)



            by_protocol.append(by_protocol_item)


        coverage = d.pop("coverage")

        liquidatable_usd = d.pop("liquidatable_usd")

        loop_exposure_usd = d.pop("loop_exposure_usd")

        positions = d.pop("positions")

        shock_bps = d.pop("shock_bps")

        def _parse_updated_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        updated_at = _parse_updated_at(d.pop("updated_at", UNSET))


        simulate_depeg_response = cls(
            advisory_note=advisory_note,
            asset=asset,
            by_protocol=by_protocol,
            coverage=coverage,
            liquidatable_usd=liquidatable_usd,
            loop_exposure_usd=loop_exposure_usd,
            positions=positions,
            shock_bps=shock_bps,
            updated_at=updated_at,
        )


        simulate_depeg_response.additional_properties = d
        return simulate_depeg_response

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
