# 8A Module Entitlement Policy

## Compatibility and defaults

- Existing workspaces remain legacy-compatible: no entitlement row means the module is enabled.
- Every workspace created after 0049 is initialized atomically with all canonical module keys.
- New workspaces receive `CORE_MENU=ENABLED`; every other module starts as `DISABLED` until a System Admin grants it.
- Disabling a module blocks all tenant reads and writes in that domain. It never deletes, archives, rewrites, or backfills business data. Re-enabling restores access to the preserved data.

## Authority and dependencies

- Only the existing platform System Admin authority (`users.is_system_admin`) may change entitlements.
- Tenant owners, admins, editors, viewers, members, and public callers cannot change entitlements.
- Dependencies are documented but never silently auto-enabled: `CAMPAIGN` depends on CRM data authority; future `TRAVEL` requires `CRM` and `COMMERCE`; `AI` is optional and does not imply that a provider credential exists.
- V1 validates dependencies before enable and at request time. Missing dependencies return a safe conflict and are never auto-enabled; a future System Admin UI must surface these requirements.

## Integrity exceptions

- New Commerce reads, orders, and payment intents are blocked when `COMMERCE` is disabled.
- The verified NewebPay notify endpoint remains outside the entitlement guard so an existing payment can complete safely and idempotently.
- New Campaign execute and resume requests are blocked when `CAMPAIGN` is disabled. Work already performed by a started synchronous execution remains historical truth; disabling does not rewrite deliveries or execution state.

## Future Travel adapter boundary

- TravelKeeper distributor maps to the existing Dealer / authorized seller authority.
- TravelKeeper customer maps to the existing CRM Person / Member authority.
- TravelKeeper order and payment extend the existing Commerce Order and Payment authorities.
- TravelKeeper commission maps to the existing Commission / Settlement / Payout authority.
- Itinerary, traveler, booking, deposit, and balance concepts are future `TRAVEL`-specific entities or Commerce extensions.
- 8A imports no TravelKeeper code or data and creates no Travel business route or table.
