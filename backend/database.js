import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


class DatabaseConnection {
  #dbPath;
  #schemaPath;
  #connection;

  constructor() {
    this.#dbPath = path.join(__dirname, "data", "train_network.db");
    this.#schemaPath = path.join(__dirname, "schema.sql");
    this.#connection = null;
  }

  /**
   * Initialize the database connection and create tables
   */
  initialize() {
    const dataDir = path.dirname(this.#dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Open database connection
    this.#connection = new Database(this.#dbPath);
    this.#connection.pragma("journal_mode = WAL");
    this.#connection.pragma("foreign_keys = ON");

    // Read and execute schema
    const schema = fs.readFileSync(this.#schemaPath, "utf8");
    this.#connection.exec(schema);

    console.log(`Database initialized at ${this.#dbPath}`);
    return this.#connection;
  }

  /**
   * Get the database instance
   */
  getConnection() {
    if (!this.#connection) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.#connection;
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.#connection) {
      this.#connection.close();
      this.#connection = null;
      console.log("Database connection closed.");
    }
  }

  /**
   * Check if database is initialized
   */
  isInitialized() {
    return this.#connection !== null;
  }
}

// Singleton instance
let dbInstance = new DatabaseConnection();

export function initDatabase() {
  return dbInstance.initialize();
}

export function getDatabase() {
  return dbInstance.getConnection();
}

export function closeDatabase() {
  dbInstance.close();
}


/**
 * RouteRepository class handles all route-related database operations
 */
class RouteRepository {
  #dbConnection;

  constructor(dbConnection) {
    this.#dbConnection = dbConnection;
  }

  /**
   * Clear all routes from the database
   */
  clear() {
    const db = this.#dbConnection.getConnection();
    db.prepare("DELETE FROM routes").run();
  }

  /**
   * Insert a single route into the database
   */
  insert(route) {
    const db = this.#dbConnection.getConnection();
    const stmt = db.prepare(`
      INSERT INTO routes (
        route_id, departure_city, arrival_city, departure_time, arrival_time,
        train_type, days_of_operation, first_class_price, second_class_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      route.routeId,
      route.from,
      route.arriveCity,
      route.departTime,
      route.arriveTime,
      route.trainType || "",
      route.days.join(","),
      route.price.first,
      route.price.second
    );
  }

  /**
   * Insert multiple routes efficiently using a transaction
   */
  insertBatch(routes) {
    const db = this.#dbConnection.getConnection();
    const insert = db.prepare(`
      INSERT INTO routes (
        route_id, departure_city, arrival_city, departure_time, arrival_time,
        train_type, days_of_operation, first_class_price, second_class_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((routes) => {
      for (const route of routes) {
        insert.run(
          route.routeId,
          route.from,
          route.arriveCity,
          route.departTime,
          route.arriveTime,
          route.trainType || "",
          route.days.join(","),
          route.price.first,
          route.price.second
        );
      }
    });

    insertMany(routes);
  }

  /**
   * Get all routes from the database
   */
  getAll() {
    const db = this.#dbConnection.getConnection();
    const rows = db.prepare("SELECT * FROM routes").all();

    return rows.map(row => this.#mapRowToRoute(row));
  }

  /**
   * Get routes departing from a specific city
   */
  getByDepartureCity(city) {
    const db = this.#dbConnection.getConnection();
    const rows = db.prepare("SELECT * FROM routes WHERE departure_city = ?").all(city);

    return rows.map(row => this.#mapRowToRoute(row));
  }

  /**
   * Count total routes in database
   */
  count() {
    const db = this.#dbConnection.getConnection();
    const result = db.prepare("SELECT COUNT(*) as count FROM routes").get();
    return result.count;
  }

  /**
   * Map database row to route object
   */
  #mapRowToRoute(row) {
    return {
      routeId: row.route_id,
      from: row.departure_city,
      arriveCity: row.arrival_city,
      departTime: row.departure_time,
      arriveTime: row.arrival_time,
      trainType: row.train_type,
      days: row.days_of_operation ? row.days_of_operation.split(",") : [],
      price: {
        first: row.first_class_price,
        second: row.second_class_price
      }
    };
  }
}

// Repository instance
let routeRepository = new RouteRepository(dbInstance);

export function clearRoutes() {
  routeRepository.clear();
}

export function insertRoute(route) {
  routeRepository.insert(route);
}

export function insertRoutesBatch(routes) {
  routeRepository.insertBatch(routes);
}

export function getAllRoutes() {
  return routeRepository.getAll();
}

export function getRoutesByDepartureCity(city) {
  return routeRepository.getByDepartureCity(city);
}

export function countRoutes() {
  return routeRepository.count();
}


/**
 * TripRepository class handles trip-related database operations
 */
class TripRepository {
  #dbConnection;

  constructor(dbConnection) {
    this.#dbConnection = dbConnection;
  }

  /**
   * Create a new trip and return the trip_id
   */
  create(connection) {
    const db = this.#dbConnection.getConnection();

    const insertTrip = db.prepare(`
      INSERT INTO trips (connection_summary, total_duration_minutes, first_class_total, second_class_total)
      VALUES (?, ?, ?, ?)
    `);

    const result = insertTrip.run(
      connection.connectionSummary || "",
      connection.totalDurationMinutes || 0,
      connection.totalPrice?.first || 0,
      connection.totalPrice?.second || 0
    );

    return result.lastInsertRowid;
  }

  /**
   * Get trips by passenger last name and ID number
   */
  getByPassenger(lastName, idNumber) {
    const db = this.#dbConnection.getConnection();

    const stmt = db.prepare(`
      SELECT DISTINCT
        t.trip_id,
        t.connection_summary,
        t.total_duration_minutes,
        t.first_class_total,
        t.second_class_total,
        t.created_at
      FROM trips t
      INNER JOIN reservations r ON t.trip_id = r.trip_id
      WHERE LOWER(r.last_name) = LOWER(?) AND LOWER(r.id_number) = LOWER(?)
      ORDER BY t.created_at DESC
    `);

    return stmt.all(lastName, idNumber);
  }
}

// Repository instance
let tripRepository = new TripRepository(dbInstance);

export function createTrip(connection) {
  return tripRepository.create(connection);
}

export function getTripsByPassenger(lastName, idNumber) {
  return tripRepository.getByPassenger(lastName, idNumber);
}


/**
 * SegmentRepository class handles trip segment operations
 */
class SegmentRepository {
  #dbConnection;

  constructor(dbConnection) {
    this.#dbConnection = dbConnection;
  }

  /**
   * Insert trip segments
   */
  insertBatch(tripId, segments, transferTimes) {
    const db = this.#dbConnection.getConnection();
    const stmt = db.prepare(`
      INSERT INTO trip_segments (trip_id, segment_order, route_id, layover_after_minutes)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = db.transaction((tripId, segments, transferTimes) => {
      segments.forEach((seg, index) => {
        stmt.run(
          tripId,
          index,
          seg.routeId,
          transferTimes[index] || 0
        );
      });
    });

    insertMany(tripId, segments, transferTimes);
  }

  /**
   * Get trip segments for a trip
   */
  getByTripId(tripId) {
    const db = this.#dbConnection.getConnection();

    const stmt = db.prepare(`
      SELECT
        ts.segment_order,
        ts.layover_after_minutes,
        r.*
      FROM trip_segments ts
      INNER JOIN routes r ON ts.route_id = r.route_id
      WHERE ts.trip_id = ?
      ORDER BY ts.segment_order
    `);

    const rows = stmt.all(tripId);

    return rows.map(row => ({
      routeId: row.route_id,
      from: row.departure_city,
      arriveCity: row.arrival_city,
      departTime: row.departure_time,
      arriveTime: row.arrival_time,
      trainType: row.train_type,
      days: row.days_of_operation ? row.days_of_operation.split(",") : [],
      price: {
        first: row.first_class_price,
        second: row.second_class_price
      },
      layoverAfter: row.layover_after_minutes
    }));
  }
}

// Repository instance
let segmentRepository = new SegmentRepository(dbInstance);

export function insertTripSegments(tripId, segments, transferTimes) {
  segmentRepository.insertBatch(tripId, segments, transferTimes);
}

export function getTripSegments(tripId) {
  return segmentRepository.getByTripId(tripId);
}

/**
 * ReservationRepository class handles reservation and ticket operations
 */
class ReservationRepository {
  #dbConnection;

  constructor(dbConnection) {
    this.#dbConnection = dbConnection;
  }

  /**
   * Create a reservation for a trip
   */
  create(tripId, traveller) {
    const db = this.#dbConnection.getConnection();
    const stmt = db.prepare(`
      INSERT INTO reservations (trip_id, first_name, last_name, age, id_number)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      tripId,
      traveller.firstName,
      traveller.lastName,
      traveller.age || 0,
      traveller.idNumber
    );

    return result.lastInsertRowid;
  }

  /**
   * Create a ticket for a reservation
   */
  createTicket(reservationId) {
    const db = this.#dbConnection.getConnection();
    const stmt = db.prepare(`
      INSERT INTO tickets (reservation_id)
      VALUES (?)
    `);

    const result = stmt.run(reservationId);
    return result.lastInsertRowid;
  }

  /**
   * Get all reservations for a trip
   */
  getByTripId(tripId) {
    const db = this.#dbConnection.getConnection();

    const stmt = db.prepare(`
      SELECT
        r.reservation_id,
        r.first_name,
        r.last_name,
        r.age,
        r.id_number,
        t.ticket_id
      FROM reservations r
      LEFT JOIN tickets t ON r.reservation_id = t.reservation_id
      WHERE r.trip_id = ?
      ORDER BY r.reservation_id
    `);

    return stmt.all(tripId);
  }
}

// Repository instance
let reservationRepository = new ReservationRepository(dbInstance);

export function createReservation(tripId, traveller) {
  return reservationRepository.create(tripId, traveller);
}

export function createTicket(reservationId) {
  return reservationRepository.createTicket(reservationId);
}

export function getReservationsByTrip(tripId) {
  return reservationRepository.getByTripId(tripId);
}


export default {
  initDatabase,
  getDatabase,
  closeDatabase,
  clearRoutes,
  insertRoute,
  insertRoutesBatch,
  getAllRoutes,
  getRoutesByDepartureCity,
  countRoutes,
  createTrip,
  insertTripSegments,
  createReservation,
  createTicket,
  getTripsByPassenger,
  getReservationsByTrip,
  getTripSegments
};

// Export classes for direct use if needed
export { DatabaseConnection, RouteRepository, TripRepository, SegmentRepository, ReservationRepository };

