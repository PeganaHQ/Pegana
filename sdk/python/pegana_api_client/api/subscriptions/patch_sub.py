from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.patch_sub import PatchSub
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    asset: str,
    *,
    body: PatchSub,
    only_id: int | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    params: dict[str, Any] = {}

    params["only_id"] = only_id


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/v1/me/subs/{asset}".format(asset=quote(str(asset), safe=""),),
        "params": params,
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | ApiError | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())



        return response_401

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())



        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | ApiError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    asset: str,
    *,
    client: AuthenticatedClient,
    body: PatchSub,
    only_id: int | Unset = UNSET,

) -> Response[Any | ApiError]:
    """ `PATCH /v1/me/subs/{asset}` — update threshold / active state for an
    asset's subscription(s). `?only_id=N` scopes to a single row.

    Args:
        asset (str):
        only_id (int | Unset):
        body (PatchSub):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError]
     """


    kwargs = _get_kwargs(
        asset=asset,
body=body,
only_id=only_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    asset: str,
    *,
    client: AuthenticatedClient,
    body: PatchSub,
    only_id: int | Unset = UNSET,

) -> Any | ApiError | None:
    """ `PATCH /v1/me/subs/{asset}` — update threshold / active state for an
    asset's subscription(s). `?only_id=N` scopes to a single row.

    Args:
        asset (str):
        only_id (int | Unset):
        body (PatchSub):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError
     """


    return sync_detailed(
        asset=asset,
client=client,
body=body,
only_id=only_id,

    ).parsed

async def asyncio_detailed(
    asset: str,
    *,
    client: AuthenticatedClient,
    body: PatchSub,
    only_id: int | Unset = UNSET,

) -> Response[Any | ApiError]:
    """ `PATCH /v1/me/subs/{asset}` — update threshold / active state for an
    asset's subscription(s). `?only_id=N` scopes to a single row.

    Args:
        asset (str):
        only_id (int | Unset):
        body (PatchSub):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError]
     """


    kwargs = _get_kwargs(
        asset=asset,
body=body,
only_id=only_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    asset: str,
    *,
    client: AuthenticatedClient,
    body: PatchSub,
    only_id: int | Unset = UNSET,

) -> Any | ApiError | None:
    """ `PATCH /v1/me/subs/{asset}` — update threshold / active state for an
    asset's subscription(s). `?only_id=N` scopes to a single row.

    Args:
        asset (str):
        only_id (int | Unset):
        body (PatchSub):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError
     """


    return (await asyncio_detailed(
        asset=asset,
client=client,
body=body,
only_id=only_id,

    )).parsed
