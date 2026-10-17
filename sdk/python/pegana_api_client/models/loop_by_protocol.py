from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
import datetime






T = TypeVar("T", bound="LoopByProtocol")



@_attrs_define
class LoopByProtocol:
    """ One protocol's latest leverage rollup for an asset.

        Attributes:
            coverage (str):
            protocol (str):
            ts (datetime.datetime):
            collateral_lev_usd (None | str | Unset): Leveraged collateral (USD) — the "loop" exposure to this asset.
            collateral_usd (None | str | Unset): Total collateral supplied (USD), of which `collateral_lev_usd` is
                leveraged.
            debt_usd (None | str | Unset): Asset borrowed/shorted (USD).
            positions (None | str | Unset): k-floored obligation-count RANGE (ADR-0036 inv.7 — never a raw count).
     """

    coverage: str
    protocol: str
    ts: datetime.datetime
    collateral_lev_usd: None | str | Unset = UNSET
    collateral_usd: None | str | Unset = UNSET
    debt_usd: None | str | Unset = UNSET
    positions: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        coverage = self.coverage

        protocol = self.protocol

        ts = self.ts.isoformat()

        collateral_lev_usd: None | str | Unset
        if isinstance(self.collateral_lev_usd, Unset):
            collateral_lev_usd = UNSET
        else:
            collateral_lev_usd = self.collateral_lev_usd

        collateral_usd: None | str | Unset
        if isinstance(self.collateral_usd, Unset):
            collateral_usd = UNSET
        else:
            collateral_usd = self.collateral_usd

        debt_usd: None | str | Unset
        if isinstance(self.debt_usd, Unset):
            debt_usd = UNSET
        else:
            debt_usd = self.debt_usd

        positions: None | str | Unset
        if isinstance(self.positions, Unset):
            positions = UNSET
        else:
            positions = self.positions


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "coverage": coverage,
            "protocol": protocol,
            "ts": ts,
        })
        if collateral_lev_usd is not UNSET:
            field_dict["collateral_lev_usd"] = collateral_lev_usd
        if collateral_usd is not UNSET:
            field_dict["collateral_usd"] = collateral_usd
        if debt_usd is not UNSET:
            field_dict["debt_usd"] = debt_usd
        if positions is not UNSET:
            field_dict["positions"] = positions

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        coverage = d.pop("coverage")

        protocol = d.pop("protocol")

        ts = datetime.datetime.fromisoformat(d.pop("ts"))




        def _parse_collateral_lev_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        collateral_lev_usd = _parse_collateral_lev_usd(d.pop("collateral_lev_usd", UNSET))


        def _parse_collateral_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        collateral_usd = _parse_collateral_usd(d.pop("collateral_usd", UNSET))


        def _parse_debt_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        debt_usd = _parse_debt_usd(d.pop("debt_usd", UNSET))


        def _parse_positions(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        positions = _parse_positions(d.pop("positions", UNSET))


        loop_by_protocol = cls(
            coverage=coverage,
            protocol=protocol,
            ts=ts,
            collateral_lev_usd=collateral_lev_usd,
            collateral_usd=collateral_usd,
            debt_usd=debt_usd,
            positions=positions,
        )


        loop_by_protocol.additional_properties = d
        return loop_by_protocol

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
