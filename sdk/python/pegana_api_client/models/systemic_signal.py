from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.cascade_rung import CascadeRung


T = TypeVar("T", bound="SystemicSignal")


@_attrs_define
class SystemicSignal:
    """One asset's systemic-exposure summary. Omitted from the feed when the asset
    carries no tracked leverage.

        Attributes:
            advisory_note (str): ADR-0036 inv.9; advisory, not a verifiable receipt.
            cascade (list[CascadeRung]): Depeg-cascade across the preset shock grid. Empty (`[]`) when no fresh
                health-factor bands exist; `cascade_coverage` is then `unknown`. Same
                basis as `/loop-exposure`: total collateral of positions whose health
                factor crosses 1, looped or not, so it can exceed `loop_exposure_usd`.
            cascade_coverage (str): Coverage of `cascade` alone (`partial` with fresh bands, `unknown`
                without), equal to `simulate-depeg`'s `coverage` for the asset.
            coverage (str): `partial` | `unknown` for the whole block. Never `full`: the cascade is
                either partial (k-floored bands) or missing.
            loop_exposure_usd (str): Σ leveraged collateral (USD) across covered lending protocols.
            protocols (list[str]): Covered protocols (e.g. `kamino`, `jupiter_lend`).
            cascade_updated_at (None | str | Unset): RFC3339 of the oldest health-factor band behind `cascade` (bands older
                than 3 hours are never used). Absent when the cascade has no bands.
            updated_at (None | str | Unset): RFC3339 of the freshest underlying snapshot.
    """

    advisory_note: str
    cascade: list[CascadeRung]
    cascade_coverage: str
    coverage: str
    loop_exposure_usd: str
    protocols: list[str]
    cascade_updated_at: None | str | Unset = UNSET
    updated_at: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        advisory_note = self.advisory_note

        cascade = []
        for cascade_item_data in self.cascade:
            cascade_item = cascade_item_data.to_dict()
            cascade.append(cascade_item)

        cascade_coverage = self.cascade_coverage

        coverage = self.coverage

        loop_exposure_usd = self.loop_exposure_usd

        protocols = self.protocols

        cascade_updated_at: None | str | Unset
        if isinstance(self.cascade_updated_at, Unset):
            cascade_updated_at = UNSET
        else:
            cascade_updated_at = self.cascade_updated_at

        updated_at: None | str | Unset
        if isinstance(self.updated_at, Unset):
            updated_at = UNSET
        else:
            updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "advisory_note": advisory_note,
                "cascade": cascade,
                "cascade_coverage": cascade_coverage,
                "coverage": coverage,
                "loop_exposure_usd": loop_exposure_usd,
                "protocols": protocols,
            }
        )
        if cascade_updated_at is not UNSET:
            field_dict["cascade_updated_at"] = cascade_updated_at
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.cascade_rung import CascadeRung

        d = dict(src_dict)
        advisory_note = d.pop("advisory_note")

        cascade = []
        _cascade = d.pop("cascade")
        for cascade_item_data in _cascade:
            cascade_item = CascadeRung.from_dict(cascade_item_data)

            cascade.append(cascade_item)

        cascade_coverage = d.pop("cascade_coverage")

        coverage = d.pop("coverage")

        loop_exposure_usd = d.pop("loop_exposure_usd")

        protocols = cast(list[str], d.pop("protocols"))

        def _parse_cascade_updated_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        cascade_updated_at = _parse_cascade_updated_at(
            d.pop("cascade_updated_at", UNSET)
        )

        def _parse_updated_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        updated_at = _parse_updated_at(d.pop("updated_at", UNSET))

        systemic_signal = cls(
            advisory_note=advisory_note,
            cascade=cascade,
            cascade_coverage=cascade_coverage,
            coverage=coverage,
            loop_exposure_usd=loop_exposure_usd,
            protocols=protocols,
            cascade_updated_at=cascade_updated_at,
            updated_at=updated_at,
        )

        systemic_signal.additional_properties = d
        return systemic_signal

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
