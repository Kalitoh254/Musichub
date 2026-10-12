BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS songs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT,
    audio_key TEXT NOT NULL UNIQUE,
    cover_key TEXT,
    download_price_kes NUMERIC(10,2) NOT NULL DEFAULT 50.00
        CHECK (download_price_kes >= 0),
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_songs_published_title
    ON songs (is_published, title);

CREATE TABLE IF NOT EXISTS purchases (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    song_id BIGINT NOT NULL REFERENCES songs(id),
    amount_kes NUMERIC(10,2) NOT NULL CHECK (amount_kes >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'KES'
        CHECK (currency = 'KES'),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchases_user_created
    ON purchases (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_id BIGINT NOT NULL REFERENCES purchases(id),
    provider TEXT NOT NULL DEFAULT 'mpesa',
    merchant_reference TEXT NOT NULL UNIQUE,
    provider_reference TEXT UNIQUE,
    phone_number TEXT,
    amount_kes NUMERIC(10,2) NOT NULL CHECK (amount_kes >= 0),
    status TEXT NOT NULL DEFAULT 'initiated'
        CHECK (status IN ('initiated', 'pending', 'successful', 'failed', 'reversed')),
    provider_result_code TEXT,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_status
    ON payment_transactions (status, created_at);

CREATE TABLE IF NOT EXISTS listening_entitlements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    song_id BIGINT NOT NULL REFERENCES songs(id),
    source TEXT NOT NULL CHECK (source IN ('purchase', 'ad', 'admin')),
    purchase_id BIGINT REFERENCES purchases(id),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_entitlements_lookup
    ON listening_entitlements (user_id, song_id, expires_at);

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (setting_key, setting_value)
VALUES
    ('default_download_price_kes', '50'::jsonb),
    ('mpesa_till_number', '"3480558"'::jsonb),
    ('ad_supported_listening_enabled', 'false'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO schema_migrations (version)
VALUES ('001_initial_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
