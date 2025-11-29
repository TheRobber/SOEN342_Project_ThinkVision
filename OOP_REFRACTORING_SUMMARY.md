# Backend OOP Refactoring Summary

## Overview
The backend has been refactored to implement Object-Oriented Programming (OOP) concepts, specifically **encapsulation**, to improve code organization, maintainability, and separation of concerns.

## Key Classes Implemented

### 1. **DatabaseConnection** (database.js)
**Purpose**: Handles database initialization and connection management
- **Encapsulation**: Uses private fields (`#dbPath`, `#schemaPath`, `#connection`)
- **Public Methods**:
  - `initialize()` - Initializes database connection and schema
  - `getConnection()` - Returns the database connection
  - `close()` - Closes the database connection
  - `isInitialized()` - Checks if database is initialized
- **Benefits**: 
  - Database paths and connection state are hidden from external access
  - Centralized connection management

### 2. **RouteRepository** (database.js)
**Purpose**: Encapsulates all route-related database operations
- **Encapsulation**: Private helper method `#mapRowToRoute()` for data mapping
- **Public Methods**:
  - `insert(route)` - Insert a single route
  - `insertBatch(routes)` - Insert multiple routes in a transaction
  - `getAll()` - Retrieve all routes
  - `getByDepartureCity(city)` - Find routes by departure city
  - `count()` - Count total routes
- **Benefits**: 
  - SQL queries and database logic are isolated
  - Easy to modify database operations without affecting other parts of the code
  - Consistent data mapping interface

### 3. **TripRepository** (database.js)
**Purpose**: Manages trip-related database operations
- **Encapsulation**: Private database connection reference
- **Public Methods**:
  - `create(connection)` - Create a new trip
  - `getByPassenger(lastName, idNumber)` - Query trips by passenger
- **Benefits**: 
  - Trip management logic is self-contained
  - Clear separation between trip and reservation operations

### 4. **SegmentRepository** (database.js)
**Purpose**: Handles trip segment database operations
- **Encapsulation**: Private connection reference
- **Public Methods**:
  - `insertBatch(tripId, segments, transferTimes)` - Insert trip segments
  - `getByTripId(tripId)` - Retrieve segments for a specific trip
- **Benefits**: 
  - Segment logic separated from trip logic
  - Cleaner data mapping for segments

### 5. **ReservationRepository** (database.js)
**Purpose**: Manages reservation and ticket operations
- **Encapsulation**: Private connection and database methods
- **Public Methods**:
  - `create(tripId, traveller)` - Create a reservation
  - `createTicket(reservationId)` - Generate a ticket
  - `getByTripId(tripId)` - Fetch all reservations for a trip
- **Benefits**: 
  - Reservation and ticket logic is cohesive
  - Private methods handle internal state management

### 6. **CSVDataProcessor** (server.js)
**Purpose**: Handles CSV file parsing and data normalization
- **Encapsulation**: Private helper methods and state for day mappings
  - `#cleanString()` - Normalize string data
  - `#nonEmpty()` - Validate non-empty values
  - `#expandDays()` - Parse day ranges
  - `#normalizeHeaders()` - Map CSV headers to standard format
- **Public Methods**:
  - `detectSeparator(filePath)` - Auto-detect CSV delimiter
  - `normalizeRow(originalRow)` - Convert CSV row to application format
  - `getMinTransferTime()` - Get minimum transfer time
- **Benefits**: 
  - Data processing logic is completely isolated
  - Easy to adjust parsing rules or validation
  - Reusable across different CSV formats

### 7. **RouteSearch** (server.js)
**Purpose**: Encapsulates all route searching and itinerary building logic
- **Encapsulation**: Private fields for routes and index, private search helper methods
  - `#routes` - In-memory route cache
  - `#indexByDepart` - Quick lookup index by departure city
  - Private utility methods for time calculations, layover validation, etc.
- **Public Methods**:
  - `loadRoutesFromDatabase()` - Load and index routes from database
  - `directSearch(from, to, day)` - Find direct routes
  - `oneStopSearch(from, to, day)` - Find single-stop connections
  - `twoStopSearch(from, to, day)` - Find double-stop connections
  - `search(from, to, day, sortBy)` - Main search method with sorting
- **Benefits**: 
  - Complex search logic is encapsulated and maintainable
  - Internal data structures (routes, index) are protected
  - Easy to optimize search algorithms without affecting API

### 8. **BookingService** (server.js)
**Purpose**: Handles all booking operations
- **Encapsulation**: Private database connection reference
- **Public Methods**:
  - `createBooking(connection, travellers)` - Book a trip with reservations
  - `summarizeConnection(conn)` - Generate connection summary
  - `getPassengerTrips(lastName, idNumber)` - Retrieve passenger's trips
- **Benefits**: 
  - Booking logic is centralized and validated
  - Clear error handling interface
  - Trip history logic is separated from booking logic

### 9. **DataLoader** (server.js)
**Purpose**: Orchestrates data loading and application initialization
- **Encapsulation**: Private references to CSV processor and route search
- **Public Methods**:
  - `loadCSV(filePath)` - Read and parse CSV file
  - `initialize(filePath)` - Complete initialization workflow
- **Benefits**: 
  - Startup sequence is clear and organized
  - Easy to modify initialization steps
  - Separates data loading from server startup

## Encapsulation Benefits

1. **Data Hiding**: Private fields (`#`) ensure internal state cannot be directly modified
2. **Controlled Access**: Public methods provide the only interface to class functionality
3. **Maintainability**: Changes to internal implementation don't affect external code
4. **Testability**: Each class has clear boundaries for unit testing
5. **Reusability**: Classes can be easily reused or extended
6. **Clear Responsibilities**: Each class has a single, well-defined purpose

## Architecture Flow

```
Frontend Request
    ↓
Express Routes (server.js)
    ↓
Service Classes (BookingService, RouteSearch)
    ↓
Repository Classes (RouteRepository, TripRepository, etc.)
    ↓
DatabaseConnection (database.js)
    ↓
SQLite Database
```

## Migration Notes

- All existing exports remain compatible with the previous interface
- Functions export repository methods using Singleton pattern
- Classes can be directly imported for advanced usage
- No breaking changes to API endpoints

## Future Improvements

- Add error handling classes for specific error types
- Create a TransactionManager class for complex multi-step operations
- Implement caching decorators for frequently accessed queries
- Add logging class for structured logging across services
