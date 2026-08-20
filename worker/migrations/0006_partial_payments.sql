ALTER TABLE client_tracks ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_bookings ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE studio_appointments ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0;

-- Os registos já confirmados continuam integralmente pagos após a migração.
UPDATE client_tracks SET paid_cents = amount_cents WHERE payment_status = 'paid';
UPDATE client_bookings SET paid_cents = amount_cents WHERE payment_status = 'paid';
UPDATE studio_appointments SET paid_cents = amount_cents WHERE payment_status = 'paid';
