from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.cascade_rung import CascadeRung
    from ..models.loop_by_protocol import LoopByProtocol


T = TypeVar("T", bound="LoopExposureResponse")


@_attrs_define
class LoopExposureResponse:
    """Cross-protocol leverage exposure for an asset.

    Attributes:
        advisory_note (str): ADR-0036 inv.9 — this is a model estimate, not a verifiable receipt.
        asset (str):
        by_protocol (list[LoopByProtocol]):
        coverage (str): `full` | `partial` | `unknown` — worst across covered protocols.
        debt_usd (str):
        loop_exposure_usd (str): Σ leveraged collateral (USD) across covered protocols.
        cascade (list[CascadeRung] | Unset): Depeg-cascade across the preset shock grid ($0 → $Nm as the depeg deepens),
            so a client renders the whole stress ladder from one call. Empty when no HF
            distribution has been enumerated for this asset.
        collateral_usd (None | str | Unset):
        updated_at (None | str | Unset): RFC3339 of the freshest protocol snapshot (absent when no data).
    """

    advisory_note: str
    asset: str
    by_protocol: list[LoopByProtocol]
    coverage: str
    debt_usd: str
    loop_exposure_usd: str
    cascade: list[CascadeRung] | Unset = UNSET
    collateral_usd: None | str | Unset = UNSET
    updated_at: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        advisory_note = self.advisory_note

        asset = self.asset

        by_protocol = []
        for by_protocol_item_data in self.by_protocol:
            by_protocol_item = by_protocol_item_data.to_dict()
            by_protocol.append(by_protocol_item)

        coverage = self.coverage

        debt_usd = self.debt_usd

        loop_exposure_usd = self.loop_exposure_usd

        cascade: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.cascade, Unset):
            cascade = []
            for cascade_item_data in self.cascade:
                cascade_item = cascade_item_data.to_dict()
                cascade.append(cascade_item)

        collateral_usd: None | str | Unset
        if isinstance(self.collateral_usd, Unset):
            collateral_usd = UNSET
        else:
            collateral_usd = self.collateral_usd

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
                "asset": asset,
                "by_protocol": by_protocol,
                "coverage": coverage,
                "debt_usd": debt_usd,
                "loop_exposure_usd": loop_exposure_usd,
            }
        )
        if cascade is not UNSET:
            field_dict["cascade"] = cascade
        if collateral_usd is not UNSET:
            field_dict["collateral_usd"] = collateral_usd
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.cascade_rung import CascadeRung
        from ..models.loop_by_protocol import LoopByProtocol

        d = dict(src_dict)
        advisory_note = d.pop("advisory_note")

        asset = d.pop("asset")

        by_protocol = []
        _by_protocol = d.pop("by_protocol")
        for by_protocol_item_data in _by_protocol:
            by_protocol_item = LoopByProtocol.from_dict(by_protocol_item_data)

            by_protocol.append(by_protocol_item)

        coverage = d.pop("coverage")

        debt_usd = d.pop("debt_usd")

        loop_exposure_usd = d.pop("loop_exposure_usd")

        _cascade = d.pop("cascade", UNSET)
        cascade: list[CascadeRung] | Unset = UNSET
        if _cascade is not UNSET:
            cascade = []
            for cascade_item_data in _cascade:
                cascade_item = CascadeRung.from_dict(cascade_item_data)

                cascade.append(cascade_item)

        def _parse_collateral_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        collateral_usd = _parse_collateral_usd(d.pop("collateral_usd", UNSET))

        def _parse_updated_at(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        updated_at = _parse_updated_at(d.pop("updated_at", UNSET))

        loop_exposure_response = cls(
            advisory_note=advisory_note,
            asset=asset,
            by_protocol=by_protocol,
            coverage=coverage,
            debt_usd=debt_usd,
            loop_exposure_usd=loop_exposure_usd,
            cascade=cascade,
            collateral_usd=collateral_usd,
            updated_at=updated_at,
        )

        loop_exposure_response.additional_properties = d
        return loop_exposure_response

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
