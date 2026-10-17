from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.delivery_result import DeliveryResult





T = TypeVar("T", bound="ReplaySummary")



@_attrs_define
class ReplaySummary:
    """ 
        Attributes:
            attempted (int):
            failed (int):
            results (list[DeliveryResult]):
            succeeded (int):
     """

    attempted: int
    failed: int
    results: list[DeliveryResult]
    succeeded: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.delivery_result import DeliveryResult
        attempted = self.attempted

        failed = self.failed

        results = []
        for results_item_data in self.results:
            results_item = results_item_data.to_dict()
            results.append(results_item)



        succeeded = self.succeeded


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "attempted": attempted,
            "failed": failed,
            "results": results,
            "succeeded": succeeded,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.delivery_result import DeliveryResult
        d = dict(src_dict)
        attempted = d.pop("attempted")

        failed = d.pop("failed")

        results = []
        _results = d.pop("results")
        for results_item_data in (_results):
            results_item = DeliveryResult.from_dict(results_item_data)



            results.append(results_item)


        succeeded = d.pop("succeeded")

        replay_summary = cls(
            attempted=attempted,
            failed=failed,
            results=results,
            succeeded=succeeded,
        )


        replay_summary.additional_properties = d
        return replay_summary

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
