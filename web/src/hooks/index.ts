/**
 * The chain layer the one shipped route uses, and only that.
 *
 * `app/providers` and the terminal import this barrel, so anything re-exported here is in the
 * production module graph whether or not a component calls it. Four hooks are deliberately absent
 * — `useAquaBalances`, `useQuote`, `useShip` and `useSwap`, which are the taker path and the raw
 * ship behind `/dev`. That page only exists as a route under `DEV_ROUTES=1` and it deep-imports
 * them, which is the right shape for a diagnostics harness: the shipped graph is exactly the
 * shipped code, checkable by walking imports from `app/app/page.tsx` rather than by trusting a
 * tree-shake.
 */
export { useDeployments, DEPLOYMENTS_QUERY_KEY } from './useDeployments';
export type { UseDeploymentsReturn } from './useDeployments';

export { useTokenBalances } from './useTokenBalances';
export type { TokenBalance, UseTokenBalancesOptions } from './useTokenBalances';

export { useShippedStrategies } from './useShippedStrategies';
export type { UseShippedStrategiesOptions } from './useShippedStrategies';

export { useDock } from './useDock';
export type { DockParams, DockResult, UseDockReturn } from './useDock';

export { useOraclePrice } from './useOraclePrice';
export type { OraclePrice, UseOraclePriceOptions, UseOraclePriceReturn } from './useOraclePrice';

export { useTxFlow, errorMessage, countTransferLogs, ERC20_TRANSFER_TOPIC } from './useTxFlow';
export type { TxStep, TxStepStatus, TxPlanStep, UseTxFlowReturn } from './useTxFlow';
