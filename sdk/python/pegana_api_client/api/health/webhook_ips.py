from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.webhook_ips_response import WebhookIpsResponse
from typing import cast



def _get_kwargs(
    
) -> dict[str, Any]:
    

    

    

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/meta/webhook-ips",
    }


    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | WebhookIpsResponse | None:
    if response.status_code == 200:
        response_200 = WebhookIpsResponse.from_dict(response.json())



        return response_200

    if response.status_code == 429:
        response_429 = ApiError.from_dict(response.json())



        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | WebhookIpsResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,

) -> Response[ApiError | WebhookIpsResponse]:
    """ GET /v1/meta/webhook-ips — IP allowlist hint for webhook subscribers.

     Pattern lifted from Linear (`6 static IPs` page) and GitHub
    (`GET /meta` with `hooks` field). Subscribers behind enterprise
    firewalls need to know which source IPs to trust; without this
    they either disable signature-based trust or refuse our deliveries.

    Source of truth is the `PEGANA_WEBHOOK_EGRESS_IPS` env var
    (comma-separated). Default falls back to the Hetzner production
    box's static IP. When we add a second box, set the env to
    `<prod-host>,<new-ip>` — no code change required.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | WebhookIpsResponse]
     """


    kwargs = _get_kwargs(
        
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,

) -> ApiError | WebhookIpsResponse | None:
    """ GET /v1/meta/webhook-ips — IP allowlist hint for webhook subscribers.

     Pattern lifted from Linear (`6 static IPs` page) and GitHub
    (`GET /meta` with `hooks` field). Subscribers behind enterprise
    firewalls need to know which source IPs to trust; without this
    they either disable signature-based trust or refuse our deliveries.

    Source of truth is the `PEGANA_WEBHOOK_EGRESS_IPS` env var
    (comma-separated). Default falls back to the Hetzner production
    box's static IP. When we add a second box, set the env to
    `<prod-host>,<new-ip>` — no code change required.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | WebhookIpsResponse
     """


    return sync_detailed(
        client=client,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,

) -> Response[ApiError | WebhookIpsResponse]:
    """ GET /v1/meta/webhook-ips — IP allowlist hint for webhook subscribers.

     Pattern lifted from Linear (`6 static IPs` page) and GitHub
    (`GET /meta` with `hooks` field). Subscribers behind enterprise
    firewalls need to know which source IPs to trust; without this
    they either disable signature-based trust or refuse our deliveries.

    Source of truth is the `PEGANA_WEBHOOK_EGRESS_IPS` env var
    (comma-separated). Default falls back to the Hetzner production
    box's static IP. When we add a second box, set the env to
    `<prod-host>,<new-ip>` — no code change required.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | WebhookIpsResponse]
     """


    kwargs = _get_kwargs(
        
    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,

) -> ApiError | WebhookIpsResponse | None:
    """ GET /v1/meta/webhook-ips — IP allowlist hint for webhook subscribers.

     Pattern lifted from Linear (`6 static IPs` page) and GitHub
    (`GET /meta` with `hooks` field). Subscribers behind enterprise
    firewalls need to know which source IPs to trust; without this
    they either disable signature-based trust or refuse our deliveries.

    Source of truth is the `PEGANA_WEBHOOK_EGRESS_IPS` env var
    (comma-separated). Default falls back to the Hetzner production
    box's static IP. When we add a second box, set the env to
    `<prod-host>,<new-ip>` — no code change required.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | WebhookIpsResponse
     """


    return (await asyncio_detailed(
        client=client,

    )).parsed
