# DEFERRED_MANDATORY_TEST_A5_A6

Before any production gate:
- A5: backend friendship=true plus verified flow writes one `FRIENDSHIP_CONFIRMED`; backend friend=false, client-only friend claims, and friendship API failure write none; retries do not inflate; analytics failure does not change qualification behavior.
- A6: only a successful `member_referral_attributions` INSERT plus verified flow writes `REFERRAL_QUALIFIED`; failed INSERT or the generic `ALREADY_QUALIFIED` catch writes none; retries dedupe; analytics failure never rolls back the qualified relationship.
- Five-stage: landing, LIFF authentication, member establishment, friendship confirmation, and qualification retain the same logical flow with no stage issuing a nonce.
- Privacy: no raw LINE UID, identity hash, LIFF token, referral code, referral flow token, PII, IP address, or device fingerprint is persisted.