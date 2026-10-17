from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.delivery_health import DeliveryHealth
  from ..models.stats_response_by_state import StatsResponseByState





T = TypeVar("T", bound="StatsResponse")



@_attrs_define
class StatsResponse:
    """ 
        Attributes:
            alerts_24h (int):
            assets_in_drift (int): Count of active assets whose most recent state is `DRIFT`. Derived from
                `by_state` so it never disagrees, but surfaced top-level so the home/
                trust strip can render a single risk number without parsing the map.
            assets_tracked (int):
            by_state (StatsResponseByState): Per-state asset counts keyed by the engine's state enum
                (`PEGGED` / `DRIFT` / `DEPEG` / `CRITICAL` / `BLACK_SWAN` / `UNKNOWN`).
                Empty buckets are omitted, not zero-filled.
            delivery_health (DeliveryHealth): Delivery-pipeline health rollup. Surfaced so the dashboard can show a
                degraded badge when notifications are silently failing — historically
                MarkdownV2 escape bugs caused alert_deliveries.status='failed' rows to
                pile up without any user-visible signal, breaking trust.
     """

    alerts_24h: int
    assets_in_drift: int
    assets_tracked: int
    by_state: StatsResponseByState
    delivery_health: DeliveryHealth
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.delivery_health import DeliveryHealth
        from ..models.stats_response_by_state import StatsResponseByState
        alerts_24h = self.alerts_24h

        assets_in_drift = self.assets_in_drift

        assets_tracked = self.assets_tracked

        by_state = self.by_state.to_dict()

        delivery_health = self.delivery_health.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "alerts_24h": alerts_24h,
            "assets_in_drift": assets_in_drift,
            "assets_tracked": assets_tracked,
            "by_state": by_state,
            "delivery_health": delivery_health,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.delivery_health import DeliveryHealth
        from ..models.stats_response_by_state import StatsResponseByState
        d = dict(src_dict)
        alerts_24h = d.pop("alerts_24h")

        assets_in_drift = d.pop("assets_in_drift")

        assets_tracked = d.pop("assets_tracked")

        by_state = StatsResponseByState.from_dict(d.pop("by_state"))




        delivery_health = DeliveryHealth.from_dict(d.pop("delivery_health"))




        stats_response = cls(
            alerts_24h=alerts_24h,
            assets_in_drift=assets_in_drift,
            assets_tracked=assets_tracked,
            by_state=by_state,
            delivery_health=delivery_health,
        )


        stats_response.additional_properties = d
        return stats_response

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
