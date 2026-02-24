# World Brain Autoscaler Operations

## Controller

Cron job: `world-brain-autoscaler`  
Script: `drovi-intelligence/scripts/world_brain_autoscale.py`

## Signal Inputs

1. Queue depth from `background_job` (`status='queued'`) grouped by pool job families.
2. Freshness lag p95 from `source_sync_run.freshness_lag_minutes` over lookback window.
3. Existing HPA bounds (`spec.minReplicas`, `spec.maxReplicas`) per worker pool.

## Control Output

1. Patch HPA `spec.minReplicas` for:
 - `drovi-world-normalize-worker`
 - `drovi-world-graph-worker`
 - `drovi-world-ml-worker`
 - `drovi-world-simulation-worker`
 - `drovi-world-critical-worker`
2. Add/update HPA annotations:
 - `world-brain.autoscaler/last-scale-at`
 - `world-brain.autoscaler/last-action`
 - `world-brain.autoscaler/last-reason`

## Safety Controls

1. Scale changes are bounded by `WORLD_AUTOSCALER_MAX_STEP`.
2. Scale-down is blocked during cooldown (`WORLD_AUTOSCALER_COOLDOWN_SECONDS`).
3. Scale-down is blocked when queue/freshness still exceeds thresholds.
4. HPA CPU/memory autoscaling remains active; autoscaler only sets floor (`minReplicas`).

## Runtime Config

1. `WORLD_AUTOSCALER_ENABLED`
2. `WORLD_AUTOSCALER_COOLDOWN_SECONDS`
3. `WORLD_AUTOSCALER_MAX_STEP`
4. `WORLD_AUTOSCALER_FRESHNESS_LOOKBACK_HOURS`
5. `WORLD_AUTOSCALER_SCALE_DOWN_QUEUE_THRESHOLD`
6. `WORLD_AUTOSCALER_SCALE_DOWN_FRESHNESS_THRESHOLD_MINUTES`
7. `WORLD_AUTOSCALER_POOL_HPA_MAP`
8. `WORLD_AUTOSCALER_FAIL_ON_ERRORS`
