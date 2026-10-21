from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.webhook_keys_response import WebhookKeysResponse
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/v1/meta/webhook-keys",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | WebhookKeysResponse | None:
    if response.status_code == 200:
        response_200 = WebhookKeysResponse.from_dict(response.json())

        return response_200

    if response.status_code == 429:
        response_429 = ApiError.from_dict(response.json())

        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | WebhookKeysResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[ApiError | WebhookKeysResponse]:
    """GET /v1/meta/webhook-keys; active Ed25519 public keys for verifying
    inbound webhook signatures.

     Lifted from the GitHub pattern (`GET /meta` with `ssh_keys`).
    During key rotation we publish BOTH the outgoing primary AND the
    incoming secondary here, so receivers can pre-trust the new key
    before we cut over. See `pegana_common::webhook_sign` for the
    full rotation playbook.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | WebhookKeysResponse]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> ApiError | WebhookKeysResponse | None:
    """GET /v1/meta/webhook-keys; active Ed25519 public keys for verifying
    inbound webhook signatures.

     Lifted from the GitHub pattern (`GET /meta` with `ssh_keys`).
    During key rotation we publish BOTH the outgoing primary AND the
    incoming secondary here, so receivers can pre-trust the new key
    before we cut over. See `pegana_common::webhook_sign` for the
    full rotation playbook.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | WebhookKeysResponse
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[ApiError | WebhookKeysResponse]:
    """GET /v1/meta/webhook-keys; active Ed25519 public keys for verifying
    inbound webhook signatures.

     Lifted from the GitHub pattern (`GET /meta` with `ssh_keys`).
    During key rotation we publish BOTH the outgoing primary AND the
    incoming secondary here, so receivers can pre-trust the new key
    before we cut over. See `pegana_common::webhook_sign` for the
    full rotation playbook.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | WebhookKeysResponse]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> ApiError | WebhookKeysResponse | None:
    """GET /v1/meta/webhook-keys; active Ed25519 public keys for verifying
    inbound webhook signatures.

     Lifted from the GitHub pattern (`GET /meta` with `ssh_keys`).
    During key rotation we publish BOTH the outgoing primary AND the
    incoming secondary here, so receivers can pre-trust the new key
    before we cut over. See `pegana_common::webhook_sign` for the
    full rotation playbook.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | WebhookKeysResponse
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
