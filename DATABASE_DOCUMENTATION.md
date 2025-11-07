# SOEN342 Project - Database Documentation


## Overview


This sprint introduces **persistence** through a relational database (SQLite). All routes, trips, reservations, and tickets are now stored persistently and survive server restarts.


---


## Database Schema


### **Tables**


#### 1. `routes`


Stores all train route segments loaded from the CSV file.


| Column               | Type     | Constraints               | Description                                     |
| -------------------- | -------- | ------------------------- | ----------------------------------------------- |
| `route_id`           | TEXT     | PRIMARY KEY               | Unique route identifier (e.g., "R00003")        |
| `departure_city`     | TEXT     | NOT NULL                  | Departure city name                             |
| `arrival_city`       | TEXT     | NOT NULL                  | Arrival city name                               |
| `departure_time`     | TEXT     | NOT NULL                  | Departure time (HH:MM format)                   |
| `arrival_time`       | TEXT     | NOT NULL                  | Arrival time (HH:MM format)                     |
| `train_type`         | TEXT     |                           | Type of train (e.g., "ICE", "TGV")              |
| `days_of_operation`  | TEXT     |                           | Comma-separated day codes (e.g., "MON,TUE,WED") |
| `first_class_price`  | REAL     | DEFAULT 0                 | First class ticket price in EUR                 |
| `second_class_price` | REAL     | DEFAULT 0                 | Second class ticket price in EUR                |
| `created_at`         | DATETIME | DEFAULT CURRENT_TIMESTAMP | Record creation timestamp                       |


**Indexes:**


- `idx_routes_departure_city` on `departure_city`
- `idx_routes_arrival_city` on `arrival_city`


---


#### 2. `trips`


Stores booked trips (connections). Each trip gets a unique auto-incrementing ID.


| Column                   | Type     | Constraints               | Description                                                     |
| ------------------------ | -------- | ------------------------- | --------------------------------------------------------------- |
| `trip_id`                | INTEGER  | PRIMARY KEY AUTOINCREMENT | Unique trip ID                                                  |
| `connection_summary`     | TEXT     |                           | Human-readable summary (e.g., "Paris → Berlin (12:00 - 18:30)") |
| `total_duration_minutes` | INTEGER  |                           | Total journey duration including layovers                       |
| `first_class_total`      | REAL     | DEFAULT 0                 | Total first class price                                         |
| `second_class_total`     | REAL     | DEFAULT 0                 | Total second class price                                        |
| `created_at`             | DATETIME | DEFAULT CURRENT_TIMESTAMP | Booking timestamp                                               |


---


#### 3. `trip_segments`


Many-to-many relationship linking trips to routes (a trip can have multiple segments).


| Column                  | Type    | Constraints                             | Description                     |
| ----------------------- | ------- | --------------------------------------- | ------------------------------- |
| `trip_id`               | INTEGER | NOT NULL, FOREIGN KEY → trips.trip_id   | Trip reference                  |
| `segment_order`         | INTEGER | NOT NULL                                | Segment order (0, 1, 2, ...)    |
| `route_id`              | TEXT    | NOT NULL, FOREIGN KEY → routes.route_id | Route reference                 |
| `layover_after_minutes` | INTEGER | DEFAULT 0                               | Layover time after this segment |


**Primary Key:** Composite `(trip_id, segment_order)`


**Foreign Keys:**


- `trip_id` → `trips(trip_id)` ON DELETE CASCADE
- `route_id` → `routes(route_id)`


---


#### 4. `reservations`


Stores passenger information for each trip.


| Column           | Type     | Constraints                           | Description                   |
| ---------------- | -------- | ------------------------------------- | ----------------------------- |
| `reservation_id` | INTEGER  | PRIMARY KEY AUTOINCREMENT             | Unique reservation ID         |
| `trip_id`        | INTEGER  | NOT NULL, FOREIGN KEY → trips.trip_id | Trip reference                |
| `first_name`     | TEXT     | NOT NULL                              | Passenger first name          |
| `last_name`      | TEXT     | NOT NULL                              | Passenger last name           |
| `age`            | INTEGER  | DEFAULT 0                             | Passenger age                 |
| `id_number`      | TEXT     | NOT NULL                              | Government ID/Passport number |
| `created_at`     | DATETIME | DEFAULT CURRENT_TIMESTAMP             | Reservation timestamp         |


**Indexes:**


- `idx_reservations_passenger` on `(last_name, id_number)`


**Foreign Keys:**


- `trip_id` → `trips(trip_id)` ON DELETE CASCADE


---


#### 5. `tickets`


Stores individual tickets (1 ticket per reservation).


| Column           | Type     | Constraints                                                | Description            |
| ---------------- | -------- | ---------------------------------------------------------- | ---------------------- |
| `ticket_id`      | INTEGER  | PRIMARY KEY AUTOINCREMENT                                  | Unique ticket ID       |
| `reservation_id` | INTEGER  | NOT NULL UNIQUE, FOREIGN KEY → reservations.reservation_id | Reservation reference  |
| `issued_at`      | DATETIME | DEFAULT CURRENT_TIMESTAMP                                  | Ticket issue timestamp |


**Foreign Keys:**


- `reservation_id` → `reservations(reservation_id)` ON DELETE CASCADE


**Constraints:**


- UNIQUE on `reservation_id` ensures 1-to-1 relationship


---


## Relationships


```
routes (1) ─────< (N) trip_segments (N) >───── (1) trips
                                                    │
                                                    │ 1
                                                    │
                                                    V N
                                              reservations
                                                    │ 1
                                                    │
                                                    V 1
                                                 tickets
```


- **1 trip** → **N trip_segments** (a connection may have multiple route segments)
- **1 trip** → **N reservations** (multiple passengers per trip)
- **1 reservation** → **1 ticket** (one-to-one relationship)


---


## Testing the New Features


### Test Persistence


1. Book a trip
2. Stop the server (`Ctrl+C`)
3. Restart the server
4. Search for your trip using "View My Trips" → should still be there!


### Test Layover Policy


Search for connections that would have long layovers:


- During the day: Connections with 2+ hour layovers will be filtered out
- After hours: Connections with 30+ minute layovers will be filtered out


### Test Trip History


1. Book multiple trips
2. Use "View My Trips" with your last name and ID
3. Should see trips categorized as "Current & Future" and "Past Trips - History"


---
