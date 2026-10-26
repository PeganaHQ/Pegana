-- Pegana — seed 14 assets v1
--
-- This is the canonical source-of-truth for the asset universe at v1.
-- Keep in sync with /assets.toml. Future versions: write a migrator that
-- reads assets.toml and emits this seed automatically.

INSERT INTO assets (symbol, mint, name, class, peg_target, decimals, token_program,
                    intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
                    pyth_feed_id, thresholds) VALUES

-- ===== LSTs =====
('jitoSOL', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 'Jito Liquid Staking',
 'lst', 'SOL', 9, 'spl',
 'sanctum_lst', '{"symbol":"jitoSOL"}'::jsonb,
 'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 '0x67be9f519b95cf24338801051f9a808eff0a578ccb388db73b7f6fe1de019ffb',
 '{"drift_bps":20,"depeg_bps":100,"critical_bps":300}'::jsonb),

('mSOL', 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 'Marinade staked SOL',
 'lst', 'SOL', 9, 'spl',
 'sanctum_lst', '{"symbol":"mSOL"}'::jsonb,
 'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 '0xc2289a6a43d2ce91c6f55caec370f4acc38a2ed477f58813334c6d03749ff2a4',
 '{"drift_bps":20,"depeg_bps":100,"critical_bps":300}'::jsonb),

('bSOL', 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', 'BlazeStake Staked SOL',
 'lst', 'SOL', 9, 'spl',
 'sanctum_lst', '{"symbol":"bSOL"}'::jsonb,
 'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 '0x89875379e70f8fbadc17aef315adf3a8d5d160b811435537e03c97e8aac97d9c',
 '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

('INF', '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', 'Infinity',
 'lst', 'SOL', 9, 'spl',
 'sanctum_lst', '{"symbol":"INF"}'::jsonb,
 'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 '0xf51570985c642c49c2d6e50156390fdba80bb6d5f7fa389d2f012ced4f7d208f',
 '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

('dSOL', 'Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ', 'Drift Staked SOL',
 'lst', 'SOL', 9, 'spl',
 'sanctum_lst', '{"symbol":"dSOL"}'::jsonb,
 'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 '0x41f858bae36e7ee3f4a3a6d4f176f0893d4a261460a52763350d00f8648195ee',
 '{"drift_bps":30,"depeg_bps":120,"critical_bps":350}'::jsonb),

('bbSOL', 'Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B', 'Bybit Staked SOL',
 'lst', 'SOL', 9, 'spl',
 'sanctum_lst', '{"symbol":"bbSOL"}'::jsonb,
 'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 '0x2997d5f9e96563cef9151cffc4580803930826fa38c4af5062de2363720769ea',
 '{"drift_bps":30,"depeg_bps":150,"critical_bps":400}'::jsonb),

('JupSOL', 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', 'Jupiter Staked SOL',
 'lst', 'SOL', 9, 'spl',
 'sanctum_lst', '{"symbol":"JupSOL"}'::jsonb,
 'jupiter_usd', '{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
 NULL,
 '{"drift_bps":40,"depeg_bps":150,"critical_bps":400}'::jsonb),

-- ===== Stables =====
('USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USD Coin',
 'stable_fiat', 'USD', 6, 'spl',
 'fixed_1_usd', '{}'::jsonb,
 'jupiter_usd', '{"numeraire":"USDT","numeraire_feed":"USDT/USD"}'::jsonb,
 '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
 '{"drift_bps":15,"depeg_bps":50,"critical_bps":200}'::jsonb),

('USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'Tether',
 'stable_fiat', 'USD', 6, 'spl',
 'fixed_1_usd', '{}'::jsonb,
 'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
 '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
 '{"drift_bps":15,"depeg_bps":50,"critical_bps":200}'::jsonb),

('PYUSD', '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 'PayPal USD',
 'stable_fiat', 'USD', 6, 'token_2022',
 'fixed_1_usd', '{}'::jsonb,
 'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
 '0xc1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692',
 '{"drift_bps":15,"depeg_bps":50,"critical_bps":200}'::jsonb),

('USDe', 'DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT', 'Ethena USDe',
 'stable_dn', 'USD', 9, 'spl',   -- 9 decimals on Solana (Wormhole NTT)
 'fixed_1_usd', '{}'::jsonb,
 'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
 '0x6ec879b1e9963de5ee97e9c8710b742d6228252a5e2ca12d4ae81d7fe5ee8c5d',
 '{"drift_bps":25,"depeg_bps":100,"critical_bps":300}'::jsonb),

('USDS', 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', 'Sky Dollar',
 'stable_cdp', 'USD', 6, 'spl',
 'fixed_1_usd', '{}'::jsonb,
 'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
 '0x77f0971af11cc8bac224917275c1bf55f2319ed5c654a1ca955c82fa2d297ea1',
 '{"drift_bps":20,"depeg_bps":75,"critical_bps":250}'::jsonb),

('hyUSD', '5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E', 'Hylo USD',
 'stable_cdp', 'USD', 6, 'spl',
 'hylo_cr', '{"exchange_program":"HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn","stability_pool":"HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ"}'::jsonb,
 'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
 NULL,
 '{"cr_drift":150,"cr_depeg":130,"cr_critical":110,"cr_black_swan":100}'::jsonb),

('BRZ', 'FtgGSFADXBtroxq8VCausXRr2of47QBf5AS1NtZCu4GD', 'Brazilian Digital Token',
 'stable_fx', 'BRL', 4, 'spl',
 'pyth_fx_cross', '{"feed":"USD/BRL","invert":true}'::jsonb,
 'jupiter_usd', '{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
 '0xd2db4dbf1aea74e0f666b0e8f73b9580d407f5e5cf931940b06dc633d7a95906',
 '{"drift_bps":100,"depeg_bps":300,"critical_bps":800}'::jsonb);
