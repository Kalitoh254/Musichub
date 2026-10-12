BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS auth_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_subject
    ON users (auth_subject)
    WHERE auth_subject IS NOT NULL;

ALTER TABLE purchases
    ADD COLUMN IF NOT EXISTS request_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_user_request_key
    ON purchases (user_id, request_key)
    WHERE request_key IS NOT NULL;

ALTER TABLE payment_transactions
    ADD COLUMN IF NOT EXISTS checkout_request_id TEXT,
    ADD COLUMN IF NOT EXISTS callback_payload_hash TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS download_entitlements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_id BIGINT NOT NULL UNIQUE REFERENCES purchases(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    song_id BIGINT NOT NULL REFERENCES songs(id),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_download_entitlements_user_song
    ON download_entitlements (user_id, song_id, status);

INSERT INTO schema_migrations (version)
VALUES ('002_purchase_core')
ON CONFLICT (version) DO NOTHING;

COMMIT;
