from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.anchor import Anchor
from ..models.calibration import Calibration
from ..models.confidence import Confidence
from ..models.peg_state import PegState
from ..models.risk_side import RiskSide
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.market_depth import MarketDepth
    from ..models.oracle_degraded import OracleDegraded


T = TypeVar("T", bound="AssetCard")


@_attrs_define
class AssetCard:
    """
    Attributes:
        anchor (Anchor): Peg anchor tells a consumer how to interpret the asset's fair value WITHOUT
            knowing Pegana's internal taxonomy:

            - `"USD"`: the asset targets exactly $1 (fiat-backed, RWA, delta-neutral,
              and CDP stablecoins). A discount from $1 IS the risk signal.

            - `"FX"`: the asset targets a fixed non-USD fiat exchange rate (e.g.
              EURC→EUR, BRZ→BRL). Read `peg_target` for the specific currency. A
              discount from the FX rate IS the risk signal.

            - `"NAV"`: the asset's fair value is its intrinsic redemption/net-asset
              value, which is NOT a fixed fiat rate (LSTs, yield-bearing stables,
              synthetic leverage). The discount is relative to NAV, and NAV itself
              moves.

            IMPORTANT: derived from `class`, NOT from `peg_target`. A yield-bearing
            stable can have `peg_target = "USD"` yet `anchor = "NAV"` because its
            price legitimately accrues above $1 over time.
        calibration (Calibration): Calibration status of an asset (and of an alert that asset emitted).

            - `provisional`: a "beta" asset: released and alerting publicly, but its
              thresholds are not yet validated over a full post-launch calibration
              window. Equivalent to `monitoring_only=true`. Read its alerts as
              experimental.
            - `calibrated`: a fully calibrated asset that counts in the launch
              denominator.

            This is the SAME vocabulary the dispatcher emits on the webhook canonical
            event (`"calibration":"provisional"|"calibrated"`), so a machine consumer
            reading both the webhook fan-out and the REST read surfaces sees one word
            for the concept instead of `calibration` there and `monitoring_only` here.
        class_ (str):
        decimals (int):
        mint (str):
        monitoring_only (bool): True when the asset is actively monitored but excluded from the
            calibrated launch denominator. This is a calibration-status flag, not a
            health state: an asset can be `PEGGED` and `monitoring_only=true`.
        name (str):
        peg_target (str):
        risk_side (RiskSide): Which direction of the signed `discount` can move this asset's published
            `state`.

            - `"below"`: only a discount (market BELOW the peg/anchor) is a risk
              signal. A premium never escalates the state. This covers USD and FX
              anchors, and also every NAV class today (LSTs, yield-bearing stables,
              synthetic leverage): for those the engine treats a premium as
              informational and classifies it PEGGED (ADR-0021), so a large negative
              `discount` on them is NOT a missed alert. An implausibly large premium on
              an LST or yield stable is reported as `UNKNOWN` (`state_reason:
              premium_sanity`), not as a depeg.
            - `"either"`: both a discount and a premium can escalate the state.
              Reserved for a NAV-anchored class without the premium carve-out; no
              tracked class uses it today.
        symbol (str):
        circulating_supply (None | str | Unset): Circulating supply of the mint (`rust_decimal`, serialized as a JSON
            string), scaled by `decimals`. This is a SIZE/CONTEXT signal; NOT a
            peg-safety signal; and is NEVER an input to `discount`/`state`/
            thresholds. Sourced from the on-chain SPL Mint account's `supply`
            field by the isolated `token_supply` indexer task on a slow (~10 min)
            cadence (migration 0065). No freshness bound is enforced on this
            field the way `updated_at` is for `discount`; supply changes slowly
            by nature. `null` until the mint has been observed at least once;
            serialized as `null` (like `discount`), not omitted.
        confidence (Confidence | None | Unset):
        current_state_duration_secs (int | None | Unset): Seconds the asset has resided in its CURRENT committed FSM
            band (engine
            `band_since`). Omitted until the engine has stamped it. Read with `state`;
            `sustained` is the thresholded view (Spec 03).
        discount (None | str | Unset): Signed discount fraction the state machine classifies: `1 - market /
            intrinsic` (positive = below NAV/peg, negative = premium), the
            EWMA-smoothed value. This is the number to use. Do NOT recompute it from
            `intrinsic_usd` / `market_usd`: for LSTs it is computed in SOL terms
            (market SOL per LST vs intrinsic SOL per LST), while each USD leg is
            converted with its own SOL/USD read, so the legs can differ from it by a
            few bps and, near zero, even in sign. `null` when there is no fresh
            snapshot.

            Worked example (live, 2026-10-21): cgntSOL published `discount`
            0.0001 while `1 - market_usd / intrinsic_usd` was -0.000051. Both are
            correct: the published value is the smoothed SOL-terms discount; the
            USD ratio mixes two SOL/USD reads. Branch on `discount` and `state`.

            Illiquid LSTs: the market leg is a Jupiter exact-in quote of one token
            to SOL (precision about 1e-9; the published value is NUMERIC(10,6)).
            When the only route is a pool that itself prices the LST at its stake
            pool NAV, the quote is NAV minus that pool's fee, so several LSTs can
            publish the same round value (e.g. exactly 0.0011). That value then
            reflects the route's fee, not an independent market price, and moves
            only if the pool's NAV or fee moves.
        discount_raw (None | str | Unset): The same tick's UNSMOOTHED discount (before the EWMA), same sign
            convention and same basis as `discount` (SOL terms for LSTs). Shown
            for transparency: `discount` is `discount_raw` after smoothing, so the
            two differ by the smoothing lag, never by basis. Omitted when there is
            no fresh snapshot.
        holder_count (int | None | Unset): Unique holder addresses, same source and same caveats as
            `liquidity_usd`. A distribution/context signal; never a peg signal.
        intrinsic_usd (None | str | Unset):
        jitter_bps_24h (None | str | Unset): Peg-jitter scalar over the trailing 24h (BSRV-03): peak-to-trough
            dispersion of the discount, `max(max_discount) - min(min_discount)`,
            in the same fraction units as `discount` (NOT basis points, despite the
            name, which is kept for v1 compatibility: multiply by 10000 for bps). A cheap stability
            measure (always >= 0) computed server-side once per scan instead of
            every client recomputing it from the averaged `series_24h`. Trailing
            24h, independent of the current-snapshot freshness bound. Omitted when
            no `discount_1m` rows exist in the window.
        liquidity_usd (None | str | Unset): Deepest-market USD liquidity, sourced from tokens.xyz's per-variant
            market snapshot (migration 0075). A SIZE/CONTEXT signal for judging how
            much size an exit can absorb, NOT a peg-safety signal and NEVER an input
            to `discount`/`state`/thresholds. `null` when tokens.xyz has no market
            for the mint (7 of 69 active assets as of 2026-08-10) or it has not been
            observed yet; `null` NEVER means zero (ADR-0019). Read together with
            `market_context_at` for freshness.
        market_cap (None | str | Unset): Market capitalization in USD = `circulating_supply × market_usd`; a
            SIZE/CONTEXT signal for gauging relative scale across assets, NOT a
            peg-safety signal and NEVER an input to `discount`/`state`/thresholds.
            `None` whenever either factor is missing (no `circulating_supply`
            observed yet, or no fresh `market_usd` snapshot). Serialized as `null`
            (like `discount`), not omitted.
        market_context_at (datetime.datetime | None | Unset): When the market-context trio above was last observed.
            These move on a
            ~30 min cadence, far slower than `updated_at`'s discount pipeline, so
            they carry their own timestamp rather than borrowing that one. `null`
            when no observation exists.
        market_depth (MarketDepth | None | Unset):
        market_usd (None | str | Unset):
        monitoring_reason (None | str | Unset): Human-readable reason for `monitoring_only=true`. Omitted for fully
            calibrated assets.
        monitoring_since (None | str | Unset): YYYY-MM-DD date when the asset entered monitoring-only status. Omitted
            for fully calibrated assets.
        oracle_degraded (None | OracleDegraded | Unset):
        risk_score (int | None | Unset): Derived 0-100 peg-risk score; a single sortable/thresholdable number for
            integrators, ALONGSIDE (never replacing) `state`. Anchored to the committed
            `state` so it never disagrees with the classification (PEGGED ≤ 24, DRIFT
            25-49, DEPEG 50-74, CRITICAL 75-94, BLACK_SWAN 95-100), interpolated within
            the band by the effective discount magnitude. `null` when `state` is
            UNKNOWN/absent, no discount exists, or thresholds are the CDP CR-form;
            we never fabricate a score (ADR-0019). Deterministic + reproducible from
            the other published fields; NOT part of any receipt hash. See
            `crates/api-rs/src/risk_score.rs`.
        series_24h (list[float] | None | Unset):
        sol_per_lst (None | str | Unset): Stake-pool SOL per share for LSTs (decimal string, at most 18 decimal
            places like the USD legs, trailing zeros trimmed). Omitted for non-LST
            assets. Reflects the LATEST intrinsic snapshot; read together with
            `updated_at` for freshness. NAV decomposition is
            `intrinsic_usd = sol_per_lst × SOL/USD`.
        state (None | PegState | Unset):
        state_reason (None | str | Unset): Advisory machine-readable reason for the snapshot's state. Explanatory
            only; never a verdict input and not part of any receipt hash.

            **Emitted today:**
            - `premium_sanity`: engine NAV-sanity override: smoothed discount exceeded
              the premium-sanity bound, state forced to UNKNOWN (intrinsic anchor
              suspect).
            - `stale_source`: API layer: no discount snapshot in the last 15 min
              (sources or engine dark), state collapsed to UNKNOWN.
            - `market_unavailable`: API layer: no discount snapshot in the last 15
              min, but the intrinsic leg IS fresh and no market tick exists in that
              window (thin market, no reliable quote). State UNKNOWN; `intrinsic_usd`
              and `updated_at` are the fresh intrinsic reading, `market_usd` is null.

            **Reserved; not yet emitted (planned for depth-gate / oracle-crosscheck
            work):** `no_oracle_crosscheck | intrinsic_unavailable | shallow_market |
            nominal`.

            Omitted when null (most rows).
        sustained (bool | None | Unset): True when the asset has held a committed ALERTING band (DRIFT+) long enough
            to be a sustained episode (a slow mechanism depeg, not a blip). A
            PEGGED/UNKNOWN asset is never `sustained`. Omitted until computed.
        thresholds (Any | Unset): Per-asset alert thresholds, served verbatim from `assets.thresholds`
            JSONB (BSRV-01). Two shapes pass through unchanged: bps-keyed
            `{"drift_bps","depeg_bps","critical_bps"}` for most assets, and the
            CDP collateral-ratio form `{"cr_drift","cr_depeg","cr_critical",
            "cr_black_swan"}` for hyUSD. This is the AUTHORITATIVE source the
            client should key band-gauge / chart threshold lines / "closest to
            breaking" sort off; replacing any hand-maintained client table. The
            column is re-synced to the engine's calibrated `assets.toml` values by
            migration `0042_resync_asset_thresholds`. Omitted only if the column
            is NULL (never, given the `NOT NULL` constraint) or fails to decode.
        updated_at (datetime.datetime | None | Unset):
        volume_24h_usd (None | str | Unset): Trailing-24h USD trading volume, same source and same caveats as
            `liquidity_usd`. Context only; never a peg signal.
        worst_abs_24h (None | str | Unset): Worst (largest-magnitude) absolute discount observed over the trailing
            24h (BSRV-02), in the same signed-fraction units as `discount`
            (e.g. `0.0123` = 123 bps). Computed as
            `max(greatest(abs(min_discount), abs(max_discount)))` over the
            `discount_1m` aggregate; discount is signed, so the abs is required to
            catch the worst tick in EITHER direction. Trailing 24h, INDEPENDENT of
            the current-snapshot 15-min freshness bound on `discount`. Omitted when
            no `discount_1m` rows exist in the window.
    """

    anchor: Anchor
    calibration: Calibration
    class_: str
    decimals: int
    mint: str
    monitoring_only: bool
    name: str
    peg_target: str
    risk_side: RiskSide
    symbol: str
    circulating_supply: None | str | Unset = UNSET
    confidence: Confidence | None | Unset = UNSET
    current_state_duration_secs: int | None | Unset = UNSET
    discount: None | str | Unset = UNSET
    discount_raw: None | str | Unset = UNSET
    holder_count: int | None | Unset = UNSET
    intrinsic_usd: None | str | Unset = UNSET
    jitter_bps_24h: None | str | Unset = UNSET
    liquidity_usd: None | str | Unset = UNSET
    market_cap: None | str | Unset = UNSET
    market_context_at: datetime.datetime | None | Unset = UNSET
    market_depth: MarketDepth | None | Unset = UNSET
    market_usd: None | str | Unset = UNSET
    monitoring_reason: None | str | Unset = UNSET
    monitoring_since: None | str | Unset = UNSET
    oracle_degraded: None | OracleDegraded | Unset = UNSET
    risk_score: int | None | Unset = UNSET
    series_24h: list[float] | None | Unset = UNSET
    sol_per_lst: None | str | Unset = UNSET
    state: None | PegState | Unset = UNSET
    state_reason: None | str | Unset = UNSET
    sustained: bool | None | Unset = UNSET
    thresholds: Any | Unset = UNSET
    updated_at: datetime.datetime | None | Unset = UNSET
    volume_24h_usd: None | str | Unset = UNSET
    worst_abs_24h: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.market_depth import MarketDepth
        from ..models.oracle_degraded import OracleDegraded

        anchor = self.anchor.value

        calibration = self.calibration.value

        class_ = self.class_

        decimals = self.decimals

        mint = self.mint

        monitoring_only = self.monitoring_only

        name = self.name

        peg_target = self.peg_target

        risk_side = self.risk_side.value

        symbol = self.symbol

        circulating_supply: None | str | Unset
        if isinstance(self.circulating_supply, Unset):
            circulating_supply = UNSET
        else:
            circulating_supply = self.circulating_supply

        confidence: None | str | Unset
        if isinstance(self.confidence, Unset):
            confidence = UNSET
        elif isinstance(self.confidence, Confidence):
            confidence = self.confidence.value
        else:
            confidence = self.confidence

        current_state_duration_secs: int | None | Unset
        if isinstance(self.current_state_duration_secs, Unset):
            current_state_duration_secs = UNSET
        else:
            current_state_duration_secs = self.current_state_duration_secs

        discount: None | str | Unset
        if isinstance(self.discount, Unset):
            discount = UNSET
        else:
            discount = self.discount

        discount_raw: None | str | Unset
        if isinstance(self.discount_raw, Unset):
            discount_raw = UNSET
        else:
            discount_raw = self.discount_raw

        holder_count: int | None | Unset
        if isinstance(self.holder_count, Unset):
            holder_count = UNSET
        else:
            holder_count = self.holder_count

        intrinsic_usd: None | str | Unset
        if isinstance(self.intrinsic_usd, Unset):
            intrinsic_usd = UNSET
        else:
            intrinsic_usd = self.intrinsic_usd

        jitter_bps_24h: None | str | Unset
        if isinstance(self.jitter_bps_24h, Unset):
            jitter_bps_24h = UNSET
        else:
            jitter_bps_24h = self.jitter_bps_24h

        liquidity_usd: None | str | Unset
        if isinstance(self.liquidity_usd, Unset):
            liquidity_usd = UNSET
        else:
            liquidity_usd = self.liquidity_usd

        market_cap: None | str | Unset
        if isinstance(self.market_cap, Unset):
            market_cap = UNSET
        else:
            market_cap = self.market_cap

        market_context_at: None | str | Unset
        if isinstance(self.market_context_at, Unset):
            market_context_at = UNSET
        elif isinstance(self.market_context_at, datetime.datetime):
            market_context_at = self.market_context_at.isoformat()
        else:
            market_context_at = self.market_context_at

        market_depth: dict[str, Any] | None | Unset
        if isinstance(self.market_depth, Unset):
            market_depth = UNSET
        elif isinstance(self.market_depth, MarketDepth):
            market_depth = self.market_depth.to_dict()
        else:
            market_depth = self.market_depth

        market_usd: None | str | Unset
        if isinstance(self.market_usd, Unset):
            market_usd = UNSET
        else:
            market_usd = self.market_usd

        monitoring_reason: None | str | Unset
        if isinstance(self.monitoring_reason, Unset):
            monitoring_reason = UNSET
        else:
            monitoring_reason = self.monitoring_reason

        monitoring_since: None | str | Unset
        if isinstance(self.monitoring_since, Unset):
            monitoring_since = UNSET
        else:
            monitoring_since = self.monitoring_since

        oracle_degraded: dict[str, Any] | None | Unset
        if isinstance(self.oracle_degraded, Unset):
            oracle_degraded = UNSET
        elif isinstance(self.oracle_degraded, OracleDegraded):
            oracle_degraded = self.oracle_degraded.to_dict()
        else:
            oracle_degraded = self.oracle_degraded

        risk_score: int | None | Unset
        if isinstance(self.risk_score, Unset):
            risk_score = UNSET
        else:
            risk_score = self.risk_score

        series_24h: list[float] | None | Unset
        if isinstance(self.series_24h, Unset):
            series_24h = UNSET
        elif isinstance(self.series_24h, list):
            series_24h = self.series_24h

        else:
            series_24h = self.series_24h

        sol_per_lst: None | str | Unset
        if isinstance(self.sol_per_lst, Unset):
            sol_per_lst = UNSET
        else:
            sol_per_lst = self.sol_per_lst

        state: None | str | Unset
        if isinstance(self.state, Unset):
            state = UNSET
        elif isinstance(self.state, PegState):
            state = self.state.value
        else:
            state = self.state

        state_reason: None | str | Unset
        if isinstance(self.state_reason, Unset):
            state_reason = UNSET
        else:
            state_reason = self.state_reason

        sustained: bool | None | Unset
        if isinstance(self.sustained, Unset):
            sustained = UNSET
        else:
            sustained = self.sustained

        thresholds = self.thresholds

        updated_at: None | str | Unset
        if isinstance(self.updated_at, Unset):
            updated_at = UNSET
        elif isinstance(self.updated_at, datetime.datetime):
            updated_at = self.updated_at.isoformat()
        else:
            updated_at = self.updated_at

        volume_24h_usd: None | str | Unset
        if isinstance(self.volume_24h_usd, Unset):
            volume_24h_usd = UNSET
        else:
            volume_24h_usd = self.volume_24h_usd

        worst_abs_24h: None | str | Unset
        if isinstance(self.worst_abs_24h, Unset):
            worst_abs_24h = UNSET
        else:
            worst_abs_24h = self.worst_abs_24h

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "anchor": anchor,
                "calibration": calibration,
                "class": class_,
                "decimals": decimals,
                "mint": mint,
                "monitoring_only": monitoring_only,
                "name": name,
                "peg_target": peg_target,
                "risk_side": risk_side,
                "symbol": symbol,
            }
        )
        if circulating_supply is not UNSET:
            field_dict["circulating_supply"] = circulating_supply
        if confidence is not UNSET:
            field_dict["confidence"] = confidence
        if current_state_duration_secs is not UNSET:
            field_dict["current_state_duration_secs"] = current_state_duration_secs
        if discount is not UNSET:
            field_dict["discount"] = discount
        if discount_raw is not UNSET:
            field_dict["discount_raw"] = discount_raw
        if holder_count is not UNSET:
            field_dict["holder_count"] = holder_count
        if intrinsic_usd is not UNSET:
            field_dict["intrinsic_usd"] = intrinsic_usd
        if jitter_bps_24h is not UNSET:
            field_dict["jitter_bps_24h"] = jitter_bps_24h
        if liquidity_usd is not UNSET:
            field_dict["liquidity_usd"] = liquidity_usd
        if market_cap is not UNSET:
            field_dict["market_cap"] = market_cap
        if market_context_at is not UNSET:
            field_dict["market_context_at"] = market_context_at
        if market_depth is not UNSET:
            field_dict["market_depth"] = market_depth
        if market_usd is not UNSET:
            field_dict["market_usd"] = market_usd
        if monitoring_reason is not UNSET:
            field_dict["monitoring_reason"] = monitoring_reason
        if monitoring_since is not UNSET:
            field_dict["monitoring_since"] = monitoring_since
        if oracle_degraded is not UNSET:
            field_dict["oracle_degraded"] = oracle_degraded
        if risk_score is not UNSET:
            field_dict["risk_score"] = risk_score
        if series_24h is not UNSET:
            field_dict["series_24h"] = series_24h
        if sol_per_lst is not UNSET:
            field_dict["sol_per_lst"] = sol_per_lst
        if state is not UNSET:
            field_dict["state"] = state
        if state_reason is not UNSET:
            field_dict["state_reason"] = state_reason
        if sustained is not UNSET:
            field_dict["sustained"] = sustained
        if thresholds is not UNSET:
            field_dict["thresholds"] = thresholds
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at
        if volume_24h_usd is not UNSET:
            field_dict["volume_24h_usd"] = volume_24h_usd
        if worst_abs_24h is not UNSET:
            field_dict["worst_abs_24h"] = worst_abs_24h

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.market_depth import MarketDepth
        from ..models.oracle_degraded import OracleDegraded

        d = dict(src_dict)
        anchor = Anchor(d.pop("anchor"))

        calibration = Calibration(d.pop("calibration"))

        class_ = d.pop("class")

        decimals = d.pop("decimals")

        mint = d.pop("mint")

        monitoring_only = d.pop("monitoring_only")

        name = d.pop("name")

        peg_target = d.pop("peg_target")

        risk_side = RiskSide(d.pop("risk_side"))

        symbol = d.pop("symbol")

        def _parse_circulating_supply(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        circulating_supply = _parse_circulating_supply(
            d.pop("circulating_supply", UNSET)
        )

        def _parse_confidence(data: object) -> Confidence | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                confidence_type_1 = Confidence(data)

                return confidence_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(Confidence | None | Unset, data)

        confidence = _parse_confidence(d.pop("confidence", UNSET))

        def _parse_current_state_duration_secs(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        current_state_duration_secs = _parse_current_state_duration_secs(
            d.pop("current_state_duration_secs", UNSET)
        )

        def _parse_discount(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        discount = _parse_discount(d.pop("discount", UNSET))

        def _parse_discount_raw(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        discount_raw = _parse_discount_raw(d.pop("discount_raw", UNSET))

        def _parse_holder_count(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        holder_count = _parse_holder_count(d.pop("holder_count", UNSET))

        def _parse_intrinsic_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        intrinsic_usd = _parse_intrinsic_usd(d.pop("intrinsic_usd", UNSET))

        def _parse_jitter_bps_24h(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        jitter_bps_24h = _parse_jitter_bps_24h(d.pop("jitter_bps_24h", UNSET))

        def _parse_liquidity_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        liquidity_usd = _parse_liquidity_usd(d.pop("liquidity_usd", UNSET))

        def _parse_market_cap(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        market_cap = _parse_market_cap(d.pop("market_cap", UNSET))

        def _parse_market_context_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                market_context_at_type_0 = datetime.datetime.fromisoformat(data)

                return market_context_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        market_context_at = _parse_market_context_at(d.pop("market_context_at", UNSET))

        def _parse_market_depth(data: object) -> MarketDepth | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                market_depth_type_1 = MarketDepth.from_dict(data)

                return market_depth_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MarketDepth | None | Unset, data)

        market_depth = _parse_market_depth(d.pop("market_depth", UNSET))

        def _parse_market_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        market_usd = _parse_market_usd(d.pop("market_usd", UNSET))

        def _parse_monitoring_reason(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        monitoring_reason = _parse_monitoring_reason(d.pop("monitoring_reason", UNSET))

        def _parse_monitoring_since(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        monitoring_since = _parse_monitoring_since(d.pop("monitoring_since", UNSET))

        def _parse_oracle_degraded(data: object) -> None | OracleDegraded | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                oracle_degraded_type_1 = OracleDegraded.from_dict(data)

                return oracle_degraded_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | OracleDegraded | Unset, data)

        oracle_degraded = _parse_oracle_degraded(d.pop("oracle_degraded", UNSET))

        def _parse_risk_score(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        risk_score = _parse_risk_score(d.pop("risk_score", UNSET))

        def _parse_series_24h(data: object) -> list[float] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                series_24h_type_0 = cast(list[float], data)

                return series_24h_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[float] | None | Unset, data)

        series_24h = _parse_series_24h(d.pop("series_24h", UNSET))

        def _parse_sol_per_lst(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sol_per_lst = _parse_sol_per_lst(d.pop("sol_per_lst", UNSET))

        def _parse_state(data: object) -> None | PegState | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                state_type_1 = PegState(data)

                return state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PegState | Unset, data)

        state = _parse_state(d.pop("state", UNSET))

        def _parse_state_reason(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        state_reason = _parse_state_reason(d.pop("state_reason", UNSET))

        def _parse_sustained(data: object) -> bool | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(bool | None | Unset, data)

        sustained = _parse_sustained(d.pop("sustained", UNSET))

        thresholds = d.pop("thresholds", UNSET)

        def _parse_updated_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                updated_at_type_0 = datetime.datetime.fromisoformat(data)

                return updated_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        updated_at = _parse_updated_at(d.pop("updated_at", UNSET))

        def _parse_volume_24h_usd(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        volume_24h_usd = _parse_volume_24h_usd(d.pop("volume_24h_usd", UNSET))

        def _parse_worst_abs_24h(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        worst_abs_24h = _parse_worst_abs_24h(d.pop("worst_abs_24h", UNSET))

        asset_card = cls(
            anchor=anchor,
            calibration=calibration,
            class_=class_,
            decimals=decimals,
            mint=mint,
            monitoring_only=monitoring_only,
            name=name,
            peg_target=peg_target,
            risk_side=risk_side,
            symbol=symbol,
            circulating_supply=circulating_supply,
            confidence=confidence,
            current_state_duration_secs=current_state_duration_secs,
            discount=discount,
            discount_raw=discount_raw,
            holder_count=holder_count,
            intrinsic_usd=intrinsic_usd,
            jitter_bps_24h=jitter_bps_24h,
            liquidity_usd=liquidity_usd,
            market_cap=market_cap,
            market_context_at=market_context_at,
            market_depth=market_depth,
            market_usd=market_usd,
            monitoring_reason=monitoring_reason,
            monitoring_since=monitoring_since,
            oracle_degraded=oracle_degraded,
            risk_score=risk_score,
            series_24h=series_24h,
            sol_per_lst=sol_per_lst,
            state=state,
            state_reason=state_reason,
            sustained=sustained,
            thresholds=thresholds,
            updated_at=updated_at,
            volume_24h_usd=volume_24h_usd,
            worst_abs_24h=worst_abs_24h,
        )

        asset_card.additional_properties = d
        return asset_card

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
