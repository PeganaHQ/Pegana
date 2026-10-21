from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.peg_signal import PegSignal
from ...types import Response


def _get_kwargs(
    mint: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/peg/feed/by-mint/{mint}".format(
            mint=quote(str(mint), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | PegSignal | None:
    if response.status_code == 200:
        response_200 = PegSignal.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | PegSignal]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    mint: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[ApiError | PegSignal]:
    """Peg signal for a single asset by mint

    Args:
        mint (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PegSignal]
    """

    kwargs = _get_kwargs(
        mint=mint,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    mint: str,
    *,
    client: AuthenticatedClient | Client,
) -> ApiError | PegSignal | None:
    """Peg signal for a single asset by mint

    Args:
        mint (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PegSignal
    """

    return sync_detailed(
        mint=mint,
        client=client,
    ).parsed


async def asyncio_detailed(
    mint: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[ApiError | PegSignal]:
    """Peg signal for a single asset by mint

    Args:
        mint (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PegSignal]
    """

    kwargs = _get_kwargs(
        mint=mint,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    mint: str,
    *,
    client: AuthenticatedClient | Client,
) -> ApiError | PegSignal | None:
    """Peg signal for a single asset by mint

    Args:
        mint (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PegSignal
    """

    return (
        await asyncio_detailed(
            mint=mint,
            client=client,
        )
    ).parsed
