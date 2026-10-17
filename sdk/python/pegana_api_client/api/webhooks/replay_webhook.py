from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.replay_summary import ReplaySummary
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
        "method": "post",
        "url": "/v1/me/webhooks/{id}/replay".format(id=quote(str(id), safe=""),),
        "params": params,
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | ReplaySummary | None:
    if response.status_code == 200:
        response_200 = ReplaySummary.from_dict(response.json())



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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | ReplaySummary]:
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

) -> Response[ApiError | ReplaySummary]:
    r""" `POST /v1/me/webhooks/{id}/replay?since=<unix_seconds>&limit=<n>` —
    re-attempt delivery of the dead-letter rows for this subscription
    inside the window. Modeled on Svix's \"Replay Missing\".

     Successful re-deliveries are NOT removed from `webhook_dead_letter`
    — the audit trail stays put. Repeated success on the same row is
    harmless (the receiver's own dedup on `x-pegana-event-id` makes the
    second delivery a no-op).

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ReplaySummary]
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

) -> ApiError | ReplaySummary | None:
    r""" `POST /v1/me/webhooks/{id}/replay?since=<unix_seconds>&limit=<n>` —
    re-attempt delivery of the dead-letter rows for this subscription
    inside the window. Modeled on Svix's \"Replay Missing\".

     Successful re-deliveries are NOT removed from `webhook_dead_letter`
    — the audit trail stays put. Repeated success on the same row is
    harmless (the receiver's own dedup on `x-pegana-event-id` makes the
    second delivery a no-op).

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ReplaySummary
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

) -> Response[ApiError | ReplaySummary]:
    r""" `POST /v1/me/webhooks/{id}/replay?since=<unix_seconds>&limit=<n>` —
    re-attempt delivery of the dead-letter rows for this subscription
    inside the window. Modeled on Svix's \"Replay Missing\".

     Successful re-deliveries are NOT removed from `webhook_dead_letter`
    — the audit trail stays put. Repeated success on the same row is
    harmless (the receiver's own dedup on `x-pegana-event-id` makes the
    second delivery a no-op).

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ReplaySummary]
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

) -> ApiError | ReplaySummary | None:
    r""" `POST /v1/me/webhooks/{id}/replay?since=<unix_seconds>&limit=<n>` —
    re-attempt delivery of the dead-letter rows for this subscription
    inside the window. Modeled on Svix's \"Replay Missing\".

     Successful re-deliveries are NOT removed from `webhook_dead_letter`
    — the audit trail stays put. Repeated success on the same row is
    harmless (the receiver's own dedup on `x-pegana-event-id` makes the
    second delivery a no-op).

    Args:
        id (UUID):
        since (int | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ReplaySummary
     """


    return (await asyncio_detailed(
        id=id,
client=client,
since=since,
limit=limit,

    )).parsed
