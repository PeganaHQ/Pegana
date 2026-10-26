from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.simulate_depeg_response import SimulateDepegResponse
from ...types import UNSET, Response


def _get_kwargs(
    symbol: str,
    *,
    shock_bps: int,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["shock_bps"] = shock_bps

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/assets/{symbol}/simulate-depeg".format(
            symbol=quote(str(symbol), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | SimulateDepegResponse | None:
    if response.status_code == 200:
        response_200 = SimulateDepegResponse.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | SimulateDepegResponse]:
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
    shock_bps: int,
) -> Response[ApiError | SimulateDepegResponse]:
    """Simulate a depeg's cross-protocol liquidation cascade (advisory)

    Args:
        symbol (str):
        shock_bps (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | SimulateDepegResponse]
    """

    kwargs = _get_kwargs(
        symbol=symbol,
        shock_bps=shock_bps,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    symbol: str,
    *,
    client: AuthenticatedClient | Client,
    shock_bps: int,
) -> ApiError | SimulateDepegResponse | None:
    """Simulate a depeg's cross-protocol liquidation cascade (advisory)

    Args:
        symbol (str):
        shock_bps (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | SimulateDepegResponse
    """

    return sync_detailed(
        symbol=symbol,
        client=client,
        shock_bps=shock_bps,
    ).parsed


async def asyncio_detailed(
    symbol: str,
    *,
    client: AuthenticatedClient | Client,
    shock_bps: int,
) -> Response[ApiError | SimulateDepegResponse]:
    """Simulate a depeg's cross-protocol liquidation cascade (advisory)

    Args:
        symbol (str):
        shock_bps (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | SimulateDepegResponse]
    """

    kwargs = _get_kwargs(
        symbol=symbol,
        shock_bps=shock_bps,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    symbol: str,
    *,
    client: AuthenticatedClient | Client,
    shock_bps: int,
) -> ApiError | SimulateDepegResponse | None:
    """Simulate a depeg's cross-protocol liquidation cascade (advisory)

    Args:
        symbol (str):
        shock_bps (int):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | SimulateDepegResponse
    """

    return (
        await asyncio_detailed(
            symbol=symbol,
            client=client,
            shock_bps=shock_bps,
        )
    ).parsed
