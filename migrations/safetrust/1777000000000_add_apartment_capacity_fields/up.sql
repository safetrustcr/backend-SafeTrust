ALTER TABLE public.apartments
  ADD COLUMN IF NOT EXISTS bathrooms INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_guests INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS floor_area DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS furnished BOOLEAN DEFAULT false;

ALTER TABLE public.apartments
  ADD CONSTRAINT valid_bathrooms CHECK (bathrooms > 0),
  ADD CONSTRAINT valid_capacity CHECK (capacity > 0),
  ADD CONSTRAINT valid_max_guests CHECK (max_guests > 0);

CREATE INDEX IF NOT EXISTS idx_apartments_capacity ON public.apartments(capacity);
CREATE INDEX IF NOT EXISTS idx_apartments_bathrooms ON public.apartments(bathrooms);
CREATE INDEX IF NOT EXISTS idx_apartments_furnished ON public.apartments(furnished);
