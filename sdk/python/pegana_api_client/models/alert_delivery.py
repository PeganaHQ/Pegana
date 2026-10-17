from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
from uuid import UUID
import datetime






T = TypeVar("T", bound="AlertDelivery")



@_attrs_define
class AlertDelivery:
    """ 
        Attributes:
            alert_id (UUID):
            asset (str):
            attempted_at (datetime.datetime):
            channel (str):
            from_state (str):
            status (str):
            to_state (str):
            ack_reason (None | str | Unset):
            acknowledged_at (datetime.datetime | None | Unset):
     """

    alert_id: UUID
    asset: str
    attempted_at: datetime.datetime
    channel: str
    from_state: str
    status: str
    to_state: str
    ack_reason: None | str | Unset = UNSET
    acknowledged_at: datetime.datetime | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        alert_id = str(self.alert_id)

        asset = self.asset

        attempted_at = self.attempted_at.isoformat()

        channel = self.channel

        from_state = self.from_state

        status = self.status

        to_state = self.to_state

        ack_reason: None | str | Unset
        if isinstance(self.ack_reason, Unset):
            ack_reason = UNSET
        else:
            ack_reason = self.ack_reason

        acknowledged_at: None | str | Unset
        if isinstance(self.acknowledged_at, Unset):
            acknowledged_at = UNSET
        elif isinstance(self.acknowledged_at, datetime.datetime):
            acknowledged_at = self.acknowledged_at.isoformat()
        else:
            acknowledged_at = self.acknowledged_at


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "alert_id": alert_id,
            "asset": asset,
            "attempted_at": attempted_at,
            "channel": channel,
            "from_state": from_state,
            "status": status,
            "to_state": to_state,
        })
        if ack_reason is not UNSET:
            field_dict["ack_reason"] = ack_reason
        if acknowledged_at is not UNSET:
            field_dict["acknowledged_at"] = acknowledged_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        alert_id = UUID(d.pop("alert_id"))




        asset = d.pop("asset")

        attempted_at = datetime.datetime.fromisoformat(d.pop("attempted_at"))




        channel = d.pop("channel")

        from_state = d.pop("from_state")

        status = d.pop("status")

        to_state = d.pop("to_state")

        def _parse_ack_reason(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        ack_reason = _parse_ack_reason(d.pop("ack_reason", UNSET))


        def _parse_acknowledged_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                acknowledged_at_type_0 = datetime.datetime.fromisoformat(data)



                return acknowledged_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        acknowledged_at = _parse_acknowledged_at(d.pop("acknowledged_at", UNSET))


        alert_delivery = cls(
            alert_id=alert_id,
            asset=asset,
            attempted_at=attempted_at,
            channel=channel,
            from_state=from_state,
            status=status,
            to_state=to_state,
            ack_reason=ack_reason,
            acknowledged_at=acknowledged_at,
        )


        alert_delivery.additional_properties = d
        return alert_delivery

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
