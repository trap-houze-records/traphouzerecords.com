ALTER TABLE clients ADD COLUMN email TEXT;
ALTER TABLE client_bookings ADD COLUMN appointment_id TEXT;
ALTER TABLE studio_appointments ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE studio_appointments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE studio_appointments ADD COLUMN payment_url TEXT;

CREATE UNIQUE INDEX clients_email_unique ON clients(email COLLATE NOCASE) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX client_bookings_appointment_unique ON client_bookings(appointment_id) WHERE appointment_id IS NOT NULL;
