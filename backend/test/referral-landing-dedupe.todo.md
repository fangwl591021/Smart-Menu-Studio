# DEFERRED_MANDATORY_TEST

same referral flow retry persists exactly one `REFERRAL_LINK_OPENED` row.

Required before any production gate:
- first request: 1 row
- second and third requests with the exact same token: still 1 row
- different new flow: 2 rows total
- writer is exercised on retries
- failed first analytics write can be recovered by same-flow retry