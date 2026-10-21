import datetime
from http import HTTPStatus
from typing import Any, cast
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.audit_index_row import AuditIndexRow
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: int | Unset = UNSET,
    exclude_pegged: bool | Unset = UNSET,
    state: str | Unset = UNSET,
    asset: str | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    before: datetime.datetime | Unset = UNSET,
    before_id: UUID | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["exclude_pegged"] = exclude_pegged

    params["state"] = state

    params["asset"] = asset

    json_since: str | Unset = UNSET
    if not isinstance(since, Unset):
        json_since = since.isoformat()
    params["since"] = json_since

    json_until: str | Unset = UNSET
    if not isinstance(until, Unset):
        json_until = until.isoformat()
    params["until"] = json_until

    json_before: str | Unset = UNSET
    if not isinstance(before, Unset):
        json_before = before.isoformat()
    params["before"] = json_before

    json_before_id: str | Unset = UNSET
    if not isinstance(before_id, Unset):
        json_before_id = str(before_id)
    params["before_id"] = json_before_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/audit",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | list[AuditIndexRow] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = AuditIndexRow.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | list[AuditIndexRow]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = UNSET,
    exclude_pegged: bool | Unset = UNSET,
    state: str | Unset = UNSET,
    asset: str | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    before: datetime.datetime | Unset = UNSET,
    before_id: UUID | Unset = UNSET,
) -> Response[Any | list[AuditIndexRow]]:
    """List recent audit receipts

    Args:
        limit (int | Unset):
        exclude_pegged (bool | Unset):
        state (str | Unset):
        asset (str | Unset):
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        before (datetime.datetime | Unset):
        before_id (UUID | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | list[AuditIndexRow]]
    """

    kwargs = _get_kwargs(
        limit=limit,
        exclude_pegged=exclude_pegged,
        state=state,
        asset=asset,
        since=since,
        until=until,
        before=before,
        before_id=before_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = UNSET,
    exclude_pegged: bool | Unset = UNSET,
    state: str | Unset = UNSET,
    asset: str | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    before: datetime.datetime | Unset = UNSET,
    before_id: UUID | Unset = UNSET,
) -> Any | list[AuditIndexRow] | None:
    """List recent audit receipts

    Args:
        limit (int | Unset):
        exclude_pegged (bool | Unset):
        state (str | Unset):
        asset (str | Unset):
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        before (datetime.datetime | Unset):
        before_id (UUID | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | list[AuditIndexRow]
    """

    return sync_detailed(
        client=client,
        limit=limit,
        exclude_pegged=exclude_pegged,
        state=state,
        asset=asset,
        since=since,
        until=until,
        before=before,
        before_id=before_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = UNSET,
    exclude_pegged: bool | Unset = UNSET,
    state: str | Unset = UNSET,
    asset: str | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    before: datetime.datetime | Unset = UNSET,
    before_id: UUID | Unset = UNSET,
) -> Response[Any | list[AuditIndexRow]]:
    """List recent audit receipts

    Args:
        limit (int | Unset):
        exclude_pegged (bool | Unset):
        state (str | Unset):
        asset (str | Unset):
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        before (datetime.datetime | Unset):
        before_id (UUID | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | list[AuditIndexRow]]
    """

    kwargs = _get_kwargs(
        limit=limit,
        exclude_pegged=exclude_pegged,
        state=state,
        asset=asset,
        since=since,
        until=until,
        before=before,
        before_id=before_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = UNSET,
    exclude_pegged: bool | Unset = UNSET,
    state: str | Unset = UNSET,
    asset: str | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,
    until: datetime.datetime | Unset = UNSET,
    before: datetime.datetime | Unset = UNSET,
    before_id: UUID | Unset = UNSET,
) -> Any | list[AuditIndexRow] | None:
    """List recent audit receipts

    Args:
        limit (int | Unset):
        exclude_pegged (bool | Unset):
        state (str | Unset):
        asset (str | Unset):
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
        before (datetime.datetime | Unset):
        before_id (UUID | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | list[AuditIndexRow]
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            exclude_pegged=exclude_pegged,
            state=state,
            asset=asset,
            since=since,
            until=until,
            before=before,
            before_id=before_id,
        )
    ).parsed
