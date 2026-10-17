from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.state_resp import StateResp
from typing import cast



def _get_kwargs(
    symbol: str,

) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/assets/{symbol}/state".format(symbol=quote(str(symbol), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | StateResp | None:
    if response.status_code == 200:
        response_200 = StateResp.from_dict(response.json())



        return response_200

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())



        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | StateResp]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    symbol: str,
    *,
    client: AuthenticatedClient | Client,

) -> Response[ApiError | StateResp]:
    """ Get an asset's current peg state

    Args:
        symbol (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | StateResp]
     """


    kwargs = _get_kwargs(
        symbol=symbol,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    symbol: str,
    *,
    client: AuthenticatedClient | Client,

) -> ApiError | StateResp | None:
    """ Get an asset's current peg state

    Args:
        symbol (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | StateResp
     """


    return sync_detailed(
        symbol=symbol,
client=client,

    ).parsed

async def asyncio_detailed(
    symbol: str,
    *,
    client: AuthenticatedClient | Client,

) -> Response[ApiError | StateResp]:
    """ Get an asset's current peg state

    Args:
        symbol (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | StateResp]
     """


    kwargs = _get_kwargs(
        symbol=symbol,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    symbol: str,
    *,
    client: AuthenticatedClient | Client,

) -> ApiError | StateResp | None:
    """ Get an asset's current peg state

    Args:
        symbol (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | StateResp
     """


    return (await asyncio_detailed(
        symbol=symbol,
client=client,

    )).parsed
