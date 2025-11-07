import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const DB_PATH = path.join(__dirname, "data", "train_network.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");


let db = null;


/**
 * Initialize the database connection and create tables
 */
export function initDatabase() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }


  // Open database connection
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); 
  db.pragma("foreign_keys = ON");  

  // Read and execute schema
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);


  console.log(`Database initialized at ${DB_PATH}`);
  return db;
}


/**
 * Get the database instance
 */
export function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}


/**
 * Close the database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log("Database connection closed.");
  }
}


/**
 * Clear all routes from the database
 */
export function clearRoutes() {
  const db = getDatabase();
  db.prepare("DELETE FROM routes").run();
}


/**
 * Insert a single route into the database
 */
export function insertRoute(route) {
  const db = getDatabase();
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
export function insertRoutesBatch(routes) {
  const db = getDatabase();
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
export function getAllRoutes() {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM routes").all();


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
    }
  }));
}


/**
 * Get routes departing from a specific city
 */
export function getRoutesByDepartureCity(city) {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM routes WHERE departure_city = ?").all(city);


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
    }
  }));
}


/**
 * Count total routes in database
 */
export function countRoutes() {
  const db = getDatabase();
  const result = db.prepare("SELECT COUNT(*) as count FROM routes").get();
  return result.count;
}


/**
 * Create a new trip and return the trip_id
 */
export function createTrip(connection) {
  const db = getDatabase();
 
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
 * Insert trip segments
 */
export function insertTripSegments(tripId, segments, transferTimes) {
  const db = getDatabase();
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
 * Create a reservation for a trip
 */
export function createReservation(tripId, traveller) {
  const db = getDatabase();
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
export function createTicket(reservationId) {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO tickets (reservation_id)
    VALUES (?)
  `);


  const result = stmt.run(reservationId);
  return result.lastInsertRowid;
}


/**
 * Get trips by passenger last name and ID number
 */
export function getTripsByPassenger(lastName, idNumber) {
  const db = getDatabase();
 
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


/**
 * Get all reservations for a trip
 */
export function getReservationsByTrip(tripId) {
  const db = getDatabase();
 
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


/**
 * Get trip segments for a trip
 */
export function getTripSegments(tripId) {
  const db = getDatabase();
 
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
