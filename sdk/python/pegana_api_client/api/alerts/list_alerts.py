from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.api_list_alert_row import ApiListAlertRow
from ...types import UNSET, Unset
from typing import cast
import datetime



def _get_kwargs(
    *,
    asset: str | Unset = UNSET,
    class_: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["asset"] = asset

    params["class"] = class_

    params["limit"] = limit

    json_since: str | Unset = UNSET
    if not isinstance(since, Unset):
        json_since = since.isoformat()
    params["since"] = json_since


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/alerts",
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | ApiListAlertRow | None:
    if response.status_code == 200:
        response_200 = ApiListAlertRow.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())



        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | ApiListAlertRow]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    asset: str | Unset = UNSET,
    class_: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,

) -> Response[ApiError | ApiListAlertRow]:
    """ List the global public feed of peg state-transition alerts (all assets)

     Public, unauthenticated feed of peg state transitions across ALL tracked assets, newest first. For
    alerts scoped to only the assets YOU subscribe to, use the authenticated `GET /v1/me/alerts`
    instead.

    Args:
        asset (str | Unset):
        class_ (str | Unset):
        limit (int | Unset):
        since (datetime.datetime | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ApiListAlertRow]
     """


    kwargs = _get_kwargs(
        asset=asset,
class_=class_,
limit=limit,
since=since,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    asset: str | Unset = UNSET,
    class_: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,

) -> ApiError | ApiListAlertRow | None:
    """ List the global public feed of peg state-transition alerts (all assets)

     Public, unauthenticated feed of peg state transitions across ALL tracked assets, newest first. For
    alerts scoped to only the assets YOU subscribe to, use the authenticated `GET /v1/me/alerts`
    instead.

    Args:
        asset (str | Unset):
        class_ (str | Unset):
        limit (int | Unset):
        since (datetime.datetime | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ApiListAlertRow
     """


    return sync_detailed(
        client=client,
asset=asset,
class_=class_,
limit=limit,
since=since,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    asset: str | Unset = UNSET,
    class_: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,

) -> Response[ApiError | ApiListAlertRow]:
    """ List the global public feed of peg state-transition alerts (all assets)

     Public, unauthenticated feed of peg state transitions across ALL tracked assets, newest first. For
    alerts scoped to only the assets YOU subscribe to, use the authenticated `GET /v1/me/alerts`
    instead.

    Args:
        asset (str | Unset):
        class_ (str | Unset):
        limit (int | Unset):
        since (datetime.datetime | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ApiListAlertRow]
     """


    kwargs = _get_kwargs(
        asset=asset,
class_=class_,
limit=limit,
since=since,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    asset: str | Unset = UNSET,
    class_: str | Unset = UNSET,
    limit: int | Unset = UNSET,
    since: datetime.datetime | Unset = UNSET,

) -> ApiError | ApiListAlertRow | None:
    """ List the global public feed of peg state-transition alerts (all assets)

     Public, unauthenticated feed of peg state transitions across ALL tracked assets, newest first. For
    alerts scoped to only the assets YOU subscribe to, use the authenticated `GET /v1/me/alerts`
    instead.

    Args:
        asset (str | Unset):
        class_ (str | Unset):
        limit (int | Unset):
        since (datetime.datetime | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ApiListAlertRow
     """


    return (await asyncio_detailed(
        client=client,
asset=asset,
class_=class_,
limit=limit,
since=since,

    )).parsed
