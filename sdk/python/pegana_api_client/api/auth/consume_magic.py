from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.consume_magic_request import ConsumeMagicRequest
from ...models.login_response import LoginResponse
from typing import cast



def _get_kwargs(
    *,
    body: ConsumeMagicRequest,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}


    

    

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/v1/auth/magic/consume",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | LoginResponse | None:
    if response.status_code == 200:
        response_200 = LoginResponse.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())



        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())



        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | LoginResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ConsumeMagicRequest,

) -> Response[ApiError | LoginResponse]:
    """ `POST /v1/auth/magic/consume` — public endpoint the web client calls
    when it lands on `/auth/magic?nonce=…`. Atomically marks the nonce
    consumed AND returns the telegram_id in a single UPDATE … RETURNING
    (race-free; two concurrent consumers can't both succeed). On hit, mints
    a 7-day session JWT — same path as Login Widget.

     Failure modes:
      - 400 if the body fails to parse.
      - 401 if the nonce is unknown, already consumed, or expired.
      - 500 if the JWT insert fails (DB issue).

    Args:
        body (ConsumeMagicRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | LoginResponse]
     """


    kwargs = _get_kwargs(
        body=body,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    body: ConsumeMagicRequest,

) -> ApiError | LoginResponse | None:
    """ `POST /v1/auth/magic/consume` — public endpoint the web client calls
    when it lands on `/auth/magic?nonce=…`. Atomically marks the nonce
    consumed AND returns the telegram_id in a single UPDATE … RETURNING
    (race-free; two concurrent consumers can't both succeed). On hit, mints
    a 7-day session JWT — same path as Login Widget.

     Failure modes:
      - 400 if the body fails to parse.
      - 401 if the nonce is unknown, already consumed, or expired.
      - 500 if the JWT insert fails (DB issue).

    Args:
        body (ConsumeMagicRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | LoginResponse
     """


    return sync_detailed(
        client=client,
body=body,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ConsumeMagicRequest,

) -> Response[ApiError | LoginResponse]:
    """ `POST /v1/auth/magic/consume` — public endpoint the web client calls
    when it lands on `/auth/magic?nonce=…`. Atomically marks the nonce
    consumed AND returns the telegram_id in a single UPDATE … RETURNING
    (race-free; two concurrent consumers can't both succeed). On hit, mints
    a 7-day session JWT — same path as Login Widget.

     Failure modes:
      - 400 if the body fails to parse.
      - 401 if the nonce is unknown, already consumed, or expired.
      - 500 if the JWT insert fails (DB issue).

    Args:
        body (ConsumeMagicRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | LoginResponse]
     """


    kwargs = _get_kwargs(
        body=body,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: ConsumeMagicRequest,

) -> ApiError | LoginResponse | None:
    """ `POST /v1/auth/magic/consume` — public endpoint the web client calls
    when it lands on `/auth/magic?nonce=…`. Atomically marks the nonce
    consumed AND returns the telegram_id in a single UPDATE … RETURNING
    (race-free; two concurrent consumers can't both succeed). On hit, mints
    a 7-day session JWT — same path as Login Widget.

     Failure modes:
      - 400 if the body fails to parse.
      - 401 if the nonce is unknown, already consumed, or expired.
      - 500 if the JWT insert fails (DB issue).

    Args:
        body (ConsumeMagicRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | LoginResponse
     """


    return (await asyncio_detailed(
        client=client,
body=body,

    )).parsed
