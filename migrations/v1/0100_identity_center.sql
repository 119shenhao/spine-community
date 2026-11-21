-- Keep OAuth state isolated so either Worker version can use the existing Google login during rollout.
CREATE TABLE identity_login_states (
 state_hash TEXT PRIMARY KEY,
 nonce TEXT NOT NULL,
 verifier TEXT NOT NULL,
 return_path TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX idx_identity_login_states_expiry ON identity_login_states(expires_at);

-- A local member can be linked to one account at the configured issuer.
CREATE UNIQUE INDEX idx_identity_center_member ON auth_identities(user_id) WHERE provider='identity_center';
