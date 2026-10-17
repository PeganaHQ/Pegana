from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.delivery_result import DeliveryResult
from typing import cast
from uuid import UUID



def _get_kwargs(
    id: UUID,

) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/me/webhooks/{id}/test".format(id=quote(str(id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | DeliveryResult | None:
    if response.status_code == 200:
        response_200 = DeliveryResult.from_dict(response.json())



        return response_200

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | DeliveryResult]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,

) -> Response[ApiError | DeliveryResult]:
    r""" `POST /v1/me/webhooks/{id}/test` — send a synthetic signed payload
    to the registered URL and return what happened. Mirrors Stripe's
    \"Send test webhook\" button. The synthetic event carries the
    `x-pegana-test: true` header so subscribers can guard prod handlers
    (e.g. skip downstream order-fill on test deliveries).

     No retry. One POST. The caller is operator-triggered, not engine-
    triggered, so retries would lie about the receiver's true health.

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | DeliveryResult]
     """


    kwargs = _get_kwargs(
        id=id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,

) -> ApiError | DeliveryResult | None:
    r""" `POST /v1/me/webhooks/{id}/test` — send a synthetic signed payload
    to the registered URL and return what happened. Mirrors Stripe's
    \"Send test webhook\" button. The synthetic event carries the
    `x-pegana-test: true` header so subscribers can guard prod handlers
    (e.g. skip downstream order-fill on test deliveries).

     No retry. One POST. The caller is operator-triggered, not engine-
    triggered, so retries would lie about the receiver's true health.

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | DeliveryResult
     """


    return sync_detailed(
        id=id,
client=client,

    ).parsed

async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,

) -> Response[ApiError | DeliveryResult]:
    r""" `POST /v1/me/webhooks/{id}/test` — send a synthetic signed payload
    to the registered URL and return what happened. Mirrors Stripe's
    \"Send test webhook\" button. The synthetic event carries the
    `x-pegana-test: true` header so subscribers can guard prod handlers
    (e.g. skip downstream order-fill on test deliveries).

     No retry. One POST. The caller is operator-triggered, not engine-
    triggered, so retries would lie about the receiver's true health.

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | DeliveryResult]
     """


    kwargs = _get_kwargs(
        id=id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,

) -> ApiError | DeliveryResult | None:
    r""" `POST /v1/me/webhooks/{id}/test` — send a synthetic signed payload
    to the registered URL and return what happened. Mirrors Stripe's
    \"Send test webhook\" button. The synthetic event carries the
    `x-pegana-test: true` header so subscribers can guard prod handlers
    (e.g. skip downstream order-fill on test deliveries).

     No retry. One POST. The caller is operator-triggered, not engine-
    triggered, so retries would lie about the receiver's true health.

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | DeliveryResult
     """


    return (await asyncio_detailed(
        id=id,
client=client,

    )).parsed
