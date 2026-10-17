from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.delivery_row import DeliveryRow
from ...types import UNSET, Unset
from typing import cast
from uuid import UUID



def _get_kwargs(
    id: UUID,
    *,
    since: int | Unset = UNSET,
    limit: int | Unset = UNSET,

) -> dict[str, Any]:
    

    

    params: dict[str, Any] = {}

    params["since"] = since

    params["limit"] = limit


    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}


    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/me/webhooks/{id}/deliveries".format(id=quote(str(id), safe=""),),
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | list[DeliveryRow] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in (_response_200):
            response_200_item = DeliveryRow.from_dict(response_200_item_data)



            response_200.append(response_200_item)

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | list[DeliveryRow]]:
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
    since: int | Unset = UNSET,
    limit: int | Unset = UNSET,

) -> Response[ApiError | list[DeliveryRow]]:
    """ `GET /v1/me/webhooks/{id}/deliveries?since=&limit=` — paged audit
    trail of every delivery attempt against this subscription, ordered
    newest first. Includes successes (`error = null`), failures, and
    `is_test = true` rows from `/test`.

     Backed by `webhook_deliveries` (migration 0023). Both the
    production fan-out (`dispatcher-rs`) and the single-shot
    `/test`+`/replay` path write here, so this is the single operator
    view of receiver health.

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | list[DeliveryRow]]
     """


    kwargs = _get_kwargs(
        id=id,
since=since,
limit=limit,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    since: int | Unset = UNSET,
    limit: int | Unset = UNSET,

) -> ApiError | list[DeliveryRow] | None:
    """ `GET /v1/me/webhooks/{id}/deliveries?since=&limit=` — paged audit
    trail of every delivery attempt against this subscription, ordered
    newest first. Includes successes (`error = null`), failures, and
    `is_test = true` rows from `/test`.

     Backed by `webhook_deliveries` (migration 0023). Both the
    production fan-out (`dispatcher-rs`) and the single-shot
    `/test`+`/replay` path write here, so this is the single operator
    view of receiver health.

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | list[DeliveryRow]
     """


    return sync_detailed(
        id=id,
client=client,
since=since,
limit=limit,

    ).parsed

async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    since: int | Unset = UNSET,
    limit: int | Unset = UNSET,

) -> Response[ApiError | list[DeliveryRow]]:
    """ `GET /v1/me/webhooks/{id}/deliveries?since=&limit=` — paged audit
    trail of every delivery attempt against this subscription, ordered
    newest first. Includes successes (`error = null`), failures, and
    `is_test = true` rows from `/test`.

     Backed by `webhook_deliveries` (migration 0023). Both the
    production fan-out (`dispatcher-rs`) and the single-shot
    `/test`+`/replay` path write here, so this is the single operator
    view of receiver health.

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | list[DeliveryRow]]
     """


    kwargs = _get_kwargs(
        id=id,
since=since,
limit=limit,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    since: int | Unset = UNSET,
    limit: int | Unset = UNSET,

) -> ApiError | list[DeliveryRow] | None:
    """ `GET /v1/me/webhooks/{id}/deliveries?since=&limit=` — paged audit
    trail of every delivery attempt against this subscription, ordered
    newest first. Includes successes (`error = null`), failures, and
    `is_test = true` rows from `/test`.

     Backed by `webhook_deliveries` (migration 0023). Both the
    production fan-out (`dispatcher-rs`) and the single-shot
    `/test`+`/replay` path write here, so this is the single operator
    view of receiver health.

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | list[DeliveryRow]
     """


    return (await asyncio_detailed(
        id=id,
client=client,
since=since,
limit=limit,

    )).parsed
