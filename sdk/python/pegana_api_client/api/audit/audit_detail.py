from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.audit_detail_response import AuditDetailResponse
from ...models.audit_gone_response import AuditGoneResponse
from ...models.audit_pending_response import AuditPendingResponse
from typing import cast



def _get_kwargs(
    alert_id: str,

) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/audit/{alert_id}".format(alert_id=quote(str(alert_id), safe=""),),
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse | None:
    if response.status_code == 200:
        response_200 = AuditDetailResponse.from_dict(response.json())



        return response_200

    if response.status_code == 202:
        response_202 = AuditPendingResponse.from_dict(response.json())



        return response_202

    if response.status_code == 400:
        response_400 = cast(Any, None)
        return response_400

    if response.status_code == 404:
        response_404 = cast(Any, None)
        return response_404

    if response.status_code == 410:
        response_410 = AuditGoneResponse.from_dict(response.json())



        return response_410

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    alert_id: str,
    *,
    client: AuthenticatedClient | Client,

) -> Response[Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse]:
    """ `GET /v1/audit/{alert_id}` — single receipt with ADR-0006 four-state
    discrimination.

     Returns `Response` (not `Json`) so each status path can carry distinct
    headers and body without fighting axum's `Result<T, E>` → IntoResponse
    conversion (which forces non-2xx into the `Err` arm).

    Args:
        alert_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse]
     """


    kwargs = _get_kwargs(
        alert_id=alert_id,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    alert_id: str,
    *,
    client: AuthenticatedClient | Client,

) -> Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse | None:
    """ `GET /v1/audit/{alert_id}` — single receipt with ADR-0006 four-state
    discrimination.

     Returns `Response` (not `Json`) so each status path can carry distinct
    headers and body without fighting axum's `Result<T, E>` → IntoResponse
    conversion (which forces non-2xx into the `Err` arm).

    Args:
        alert_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse
     """


    return sync_detailed(
        alert_id=alert_id,
client=client,

    ).parsed

async def asyncio_detailed(
    alert_id: str,
    *,
    client: AuthenticatedClient | Client,

) -> Response[Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse]:
    """ `GET /v1/audit/{alert_id}` — single receipt with ADR-0006 four-state
    discrimination.

     Returns `Response` (not `Json`) so each status path can carry distinct
    headers and body without fighting axum's `Result<T, E>` → IntoResponse
    conversion (which forces non-2xx into the `Err` arm).

    Args:
        alert_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse]
     """


    kwargs = _get_kwargs(
        alert_id=alert_id,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    alert_id: str,
    *,
    client: AuthenticatedClient | Client,

) -> Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse | None:
    """ `GET /v1/audit/{alert_id}` — single receipt with ADR-0006 four-state
    discrimination.

     Returns `Response` (not `Json`) so each status path can carry distinct
    headers and body without fighting axum's `Result<T, E>` → IntoResponse
    conversion (which forces non-2xx into the `Err` arm).

    Args:
        alert_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | AuditDetailResponse | AuditGoneResponse | AuditPendingResponse
     """


    return (await asyncio_detailed(
        alert_id=alert_id,
client=client,

    )).parsed
