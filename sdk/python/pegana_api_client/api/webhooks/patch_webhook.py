from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.patch_webhook import PatchWebhook
from ...models.webhook import Webhook
from typing import cast
from uuid import UUID



def _get_kwargs(
    id: UUID,
    *,
    body: PatchWebhook,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/v1/me/webhooks/{id}".format(id=quote(str(id), safe=""),),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | Webhook | None:
    if response.status_code == 200:
        response_200 = Webhook.from_dict(response.json())



        return response_200

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | Webhook]:
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
    body: PatchWebhook,

) -> Response[ApiError | Webhook]:
    r""" `PATCH /v1/me/webhooks/{id}` — partial update of a subscription
    keeping its `id` (and so its `webhook_deliveries` history) intact.

     The previous \"delete + re-create\" workflow orphaned the audit
    trail under a new id. This endpoint keeps continuity for
    dashboards and replay.

    Returns the full webhook row after the update. 404 if the id
    belongs to a different user (no existence-leak).

    Args:
        id (UUID):
        body (PatchWebhook):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | Webhook]
     """


    kwargs = _get_kwargs(
        id=id,
body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PatchWebhook,

) -> ApiError | Webhook | None:
    r""" `PATCH /v1/me/webhooks/{id}` — partial update of a subscription
    keeping its `id` (and so its `webhook_deliveries` history) intact.

     The previous \"delete + re-create\" workflow orphaned the audit
    trail under a new id. This endpoint keeps continuity for
    dashboards and replay.

    Returns the full webhook row after the update. 404 if the id
    belongs to a different user (no existence-leak).

    Args:
        id (UUID):
        body (PatchWebhook):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | Webhook
     """


    return sync_detailed(
        id=id,
client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PatchWebhook,

) -> Response[ApiError | Webhook]:
    r""" `PATCH /v1/me/webhooks/{id}` — partial update of a subscription
    keeping its `id` (and so its `webhook_deliveries` history) intact.

     The previous \"delete + re-create\" workflow orphaned the audit
    trail under a new id. This endpoint keeps continuity for
    dashboards and replay.

    Returns the full webhook row after the update. 404 if the id
    belongs to a different user (no existence-leak).

    Args:
        id (UUID):
        body (PatchWebhook):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | Webhook]
     """


    kwargs = _get_kwargs(
        id=id,
body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PatchWebhook,

) -> ApiError | Webhook | None:
    r""" `PATCH /v1/me/webhooks/{id}` — partial update of a subscription
    keeping its `id` (and so its `webhook_deliveries` history) intact.

     The previous \"delete + re-create\" workflow orphaned the audit
    trail under a new id. This endpoint keeps continuity for
    dashboards and replay.

    Returns the full webhook row after the update. 404 if the id
    belongs to a different user (no existence-leak).

    Args:
        id (UUID):
        body (PatchWebhook):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | Webhook
     """


    return (await asyncio_detailed(
        id=id,
client=client,
body=body,

    )).parsed
