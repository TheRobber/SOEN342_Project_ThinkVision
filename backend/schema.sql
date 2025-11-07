CREATE TABLE IF NOT EXISTS routes (
    route_id TEXT PRIMARY KEY,
    departure_city TEXT NOT NULL,
    arrival_city TEXT NOT NULL,
    departure_time TEXT NOT NULL,
    arrival_time TEXT NOT NULL,
    train_type TEXT,
    days_of_operation TEXT,  
    first_class_price REAL DEFAULT 0,
    second_class_price REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


Index for fast departure city lookups
CREATE INDEX IF NOT EXISTS idx_routes_departure_city ON routes(departure_city);
CREATE INDEX IF NOT EXISTS idx_routes_arrival_city ON routes(arrival_city);




-- TABLE: trips
CREATE TABLE IF NOT EXISTS trips (
    trip_id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_summary TEXT,
    total_duration_minutes INTEGER,
    first_class_total REAL DEFAULT 0,
    second_class_total REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);




-- TABLE: trip_segments
CREATE TABLE IF NOT EXISTS trip_segments (
    trip_id INTEGER NOT NULL,
    segment_order INTEGER NOT NULL,
    route_id TEXT NOT NULL,
    layover_after_minutes INTEGER DEFAULT 0,
    PRIMARY KEY (trip_id, segment_order),
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes(route_id)
);


-- TABLE: reservations
CREATE TABLE IF NOT EXISTS reservations (
    reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    age INTEGER DEFAULT 0,
    id_number TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE CASCADE
);


-- Index for fast passenger lookup
CREATE INDEX IF NOT EXISTS idx_reservations_passenger ON reservations(last_name, id_number);




-- TABLE: tickets
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER NOT NULL UNIQUE,
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(reservation_id) ON DELETE CASCADE
);
