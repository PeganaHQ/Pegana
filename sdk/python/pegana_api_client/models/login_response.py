from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.user_view import UserView





T = TypeVar("T", bound="LoginResponse")



@_attrs_define
class LoginResponse:
    """ 
        Attributes:
            expires_at (datetime.datetime):
            token (str):
            user (UserView):
     """

    expires_at: datetime.datetime
    token: str
    user: UserView
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.user_view import UserView
        expires_at = self.expires_at.isoformat()

        token = self.token

        user = self.user.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "expires_at": expires_at,
            "token": token,
            "user": user,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.user_view import UserView
        d = dict(src_dict)
        expires_at = datetime.datetime.fromisoformat(d.pop("expires_at"))




        token = d.pop("token")

        user = UserView.from_dict(d.pop("user"))




        login_response = cls(
            expires_at=expires_at,
            token=token,
            user=user,
        )


        login_response.additional_properties = d
        return login_response

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
