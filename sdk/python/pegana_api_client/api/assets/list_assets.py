from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.api_list_asset_card import ApiListAssetCard
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    class_: str | Unset = UNSET,
    peg: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["class"] = class_

    params["peg"] = peg

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/assets",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | ApiListAssetCard | None:
    if response.status_code == 200:
        response_200 = ApiListAssetCard.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 429:
        response_429 = ApiError.from_dict(response.json())

        return response_429

    if response.status_code == 500:
        response_500 = ApiError.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | ApiListAssetCard]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    class_: str | Unset = UNSET,
    peg: str | Unset = UNSET,
) -> Response[ApiError | ApiListAssetCard]:
    """List all active assets with their latest peg snapshot

     Returns every active asset with its latest discount, state, and peg-snapshot. This is the dashboard
    screener endpoint; for the public receipt ledger of peg state-transition alerts, use `GET /v1/audit`
    instead.

    Args:
        class_ (str | Unset):
        peg (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ApiListAssetCard]
    """

    kwargs = _get_kwargs(
        class_=class_,
        peg=peg,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    class_: str | Unset = UNSET,
    peg: str | Unset = UNSET,
) -> ApiError | ApiListAssetCard | None:
    """List all active assets with their latest peg snapshot

     Returns every active asset with its latest discount, state, and peg-snapshot. This is the dashboard
    screener endpoint; for the public receipt ledger of peg state-transition alerts, use `GET /v1/audit`
    instead.

    Args:
        class_ (str | Unset):
        peg (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ApiListAssetCard
    """

    return sync_detailed(
        client=client,
        class_=class_,
        peg=peg,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    class_: str | Unset = UNSET,
    peg: str | Unset = UNSET,
) -> Response[ApiError | ApiListAssetCard]:
    """List all active assets with their latest peg snapshot

     Returns every active asset with its latest discount, state, and peg-snapshot. This is the dashboard
    screener endpoint; for the public receipt ledger of peg state-transition alerts, use `GET /v1/audit`
    instead.

    Args:
        class_ (str | Unset):
        peg (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ApiListAssetCard]
    """

    kwargs = _get_kwargs(
        class_=class_,
        peg=peg,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    class_: str | Unset = UNSET,
    peg: str | Unset = UNSET,
) -> ApiError | ApiListAssetCard | None:
    """List all active assets with their latest peg snapshot

     Returns every active asset with its latest discount, state, and peg-snapshot. This is the dashboard
    screener endpoint; for the public receipt ledger of peg state-transition alerts, use `GET /v1/audit`
    instead.

    Args:
        class_ (str | Unset):
        peg (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ApiListAssetCard
    """

    return (
        await asyncio_detailed(
            client=client,
            class_=class_,
            peg=peg,
        )
    ).parsed
