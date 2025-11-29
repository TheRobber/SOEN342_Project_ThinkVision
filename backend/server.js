import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";
import * as db from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const dataFile = path.join(__dirname, "data", "eu_rail_network.csv");

const PORT = process.env.PORT || 3001;

class CSVDataProcessor {
  #minTransferTime = 10;
  #dayNameToCode = new Map([
    ["mon","MON"], ["monday","MON"],
    ["tue","TUE"], ["tues","TUE"], ["tuesday","TUE"],
    ["wed","WED"], ["weds","WED"], ["wednesday","WED"],
    ["thu","THU"], ["thur","THU"], ["thurs","THU"], ["thursday","THU"],
    ["fri","FRI"], ["friday","FRI"],
    ["sat","SAT"], ["saturday","SAT"],
    ["sun","SUN"], ["sunday","SUN"],
  ]);

  constructor(minTransferTime = 10) {
    this.#minTransferTime = minTransferTime;
  }

  getMinTransferTime() {
    return this.#minTransferTime;
  }

  #cleanString(segment) {
    return (segment ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  #nonEmpty(segment) {
    return segment != null && String(segment).trim() !== "";
  }

  #expandDays(originalRow) {
    const segment = this.#cleanString(originalRow);
    if (!this.#nonEmpty(segment)) return [];
    if (segment.includes("daily") || segment === "all") {
      return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].slice();
    }

    const parts = segment.split(",").map(p => p.trim()).filter(Boolean);
    const result = [];

    const addDay = (name) => {
      const code = this.#dayNameToCode.get(name) || this.#dayNameToCode.get(name.slice(0,3));
      if (code && !result.includes(code)) result.push(code);
    };

    for (const p of parts) {
      if (p.includes("-")) {
        const [a, b] = p.split("-").map(x => x.trim());
        if (!a || !b) continue;

        const daysArr = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
        const start = daysArr.indexOf(this.#dayNameToCode.get(a) || this.#dayNameToCode.get(a.slice(0,3)));
        const end   = daysArr.indexOf(this.#dayNameToCode.get(b) || this.#dayNameToCode.get(b.slice(0,3)));

        if (start === -1 || end === -1) continue;

        if (start <= end) {
          for (let i = start; i <= end; i++) {
            if (!result.includes(daysArr[i])) result.push(daysArr[i]);
          }
        } else {
          for (let i = start; i < start + 7; i++) {
            const idx = i % 7;
            result.push(daysArr[idx]);
            if (idx === end) break;
          }
          for (let i = result.length - 1; i >= 0; i--) {
            if (result.indexOf(result[i]) !== i) result.splice(i,1);
          }
        }
      } else {
        addDay(p);
      }
    }
    return result;
  }

  detectSeparator(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const firstLine = (content.split(/\r?\n/).find(l => l.trim().length) || "").slice(0, 200);
      const counts = {
        ",": (firstLine.match(/,/g) || []).length,
        ";": (firstLine.match(/;/g) || []).length,
        "\t": (firstLine.match(/\t/g) || []).length,
      };
      return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0] || ",";
    } catch {
      return ",";
    }
  }

  #normalizeHeaders(row) {
    const cleaned = {};
    for (const [key,value] of Object.entries(row)) cleaned[this.#cleanString(key)] = value;

    const result = { ...cleaned };

    result["route_id"]         = result["route id"] ?? result["route_id"] ?? result["id"];
    result["depart_city"]      = result["departure city"] ?? result["depart_city"] ?? result["from"];
    result["arrive_city"]      = result["arrival city"] ?? result["arrive_city"] ?? result["to"];
    result["depart_time"]      = result["departure time"] ?? result["depart_time"] ?? result["departure"];
    result["arrive_time"]      = result["arrival time"] ?? result["arrive_time"] ?? result["arrival"];
    result["train_type"]       = result["train type"] ?? result["train_type"] ?? result["type"];
    result["days"]             = result["days of operation"] ?? result["days"] ?? result["valid_days"];
    result["first_class_eur"]  = result["first class ticket rate (in euro)"] ?? result["first_class_eur"] ?? result["first"];
    result["second_class_eur"] = result["second class ticket rate (in euro)"] ?? result["second_class_eur"] ?? result["second"];

    return result;
  }

  normalizeRow(originalRow) {
    const normalizedRow = this.#normalizeHeaders(originalRow);

    const row = {
      routeId: normalizedRow["route_id"]?.toString().trim(),
      from: normalizedRow["depart_city"]?.toString().trim(),
      arriveCity: normalizedRow["arrive_city"]?.toString().trim(),
      departTime: normalizedRow["depart_time"]?.toString().trim(),
      arriveTime: normalizedRow["arrive_time"]?.toString().trim(),
      trainType: normalizedRow["train_type"]?.toString().trim(),
      days: this.#expandDays(normalizedRow["days"]),
      price: {
        first: Number(normalizedRow["first_class_eur"]) || 0,
        second: Number(normalizedRow["second_class_eur"]) || 0,
      },
    };

    if (!this.#nonEmpty(row.from) || !this.#nonEmpty(row.arriveCity)) return null;
    if (!this.#nonEmpty(row.departTime) || !this.#nonEmpty(row.arriveTime)) return null;

    return row;
  }
}

const csvProcessor = new CSVDataProcessor(10);
const minTransferTime = csvProcessor.getMinTransferTime();

/**
 * RouteSearch class handles route searching and indexing
 */
class RouteSearch {
  #routes = [];
  #indexByDepart = new Map();

  #cleanString(segment) {
    return (segment ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  #nonEmpty(segment) {
    return segment != null && String(segment).trim() !== "";
  }

  loadRoutesFromDatabase() {
    this.#routes = db.getAllRoutes();
    this.#buildIndex();
    console.log(`Loaded ${this.#routes.length} routes from database into memory`);
  }

  #buildIndex() {
    this.#indexByDepart = new Map();
    for (const r of this.#routes) {
      const key = this.#cleanString(r.from);
      if (!this.#indexByDepart.has(key)) this.#indexByDepart.set(key, []);
      this.#indexByDepart.get(key).push(r);
    }
  }

  #timeToMinutes(time) {
    const [hours, minutes] = (time || "").split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
    return hours * 60 + minutes;
  }

  #segmentDurationMinutes(segment) {
    const departure = this.#timeToMinutes(segment.departTime);
    const arrival = this.#timeToMinutes(segment.arriveTime);
    return arrival >= departure
      ? arrival - departure
      : arrival + 24 * 60 - departure;
  }

  #transferMinutes(prev, next) {
    const arrival = this.#timeToMinutes(prev.arriveTime);
    const departure = this.#timeToMinutes(next.departTime);
    const diff = departure - arrival;
    return diff >= 0 ? diff : diff + 24 * 60;
  }

  #sumPrice(segments) {
    return segments.reduce(
      (total, s) => ({
        first: total.first + (s.price.first || 0),
        second: total.second + (s.price.second || 0),
      }),
      { first: 0, second: 0 }
    );
  }

  #toItinerary(segments) {
    const transfers = [];
    let duration = 0;
    for (let i = 0; i < segments.length; i++) {
      duration += this.#segmentDurationMinutes(segments[i]);
      if (i < segments.length - 1) {
        transfers.push(this.#transferMinutes(segments[i], segments[i + 1]));
      }
    }
    duration += transfers.reduce((a, b) => a + b, 0);
    return {
      id: segments.map((s) => s.routeId).join("+"),
      totalDurationMinutes: duration,
      totalPrice: this.#sumPrice(segments),
      transferTimes: transfers,
      segments,
    };
  }

  #matchesDay(segment, day) {
    return !this.#nonEmpty(day) || segment.days.includes(day.toUpperCase());
  }

  #isLayoverAcceptable(arrivalTime, departureTime) {
    const layoverMinutes = this.#transferMinutes(
      { arriveTime: arrivalTime },
      { departTime: departureTime }
    );

    const arrivalHour = parseInt(arrivalTime.split(":")[0]);
    const isDayHours = arrivalHour >= 6 && arrivalHour < 22;

    if (isDayHours) {
      return layoverMinutes <= 120;
    } else {
      return layoverMinutes <= 30;
    }
  }

  #getStartList(from) {
    const cleanedCity = this.#cleanString(from);
    if (!cleanedCity) return [];
    const exact = this.#indexByDepart.get(cleanedCity) || [];
    if (exact.length) return exact;
    return this.#routes.filter(
      (r) => this.#cleanString(r.from).includes(cleanedCity)
    );
  }

  directSearch(from, to, day) {
    const startList = this.#getStartList(from);
    const cleanedTo = this.#cleanString(to);
    return startList.filter(
      (r) =>
        this.#cleanString(r.arriveCity).includes(cleanedTo) &&
        this.#matchesDay(r, day)
    );
  }

  oneStopSearch(from, to, day) {
    const results = [];
    const cleanedTo = this.#cleanString(to);
    const startList = this.#getStartList(from);

    for (const firstRoute of startList) {
      const midCity = this.#cleanString(firstRoute.arriveCity);
      const options =
        this.#indexByDepart.get(midCity) ||
        this.#routes.filter((r) => this.#cleanString(r.from) === midCity);

      for (const secondRoute of options) {
        const layoverMins = this.#transferMinutes(firstRoute, secondRoute);

        if (
          this.#cleanString(secondRoute.arriveCity).includes(cleanedTo) &&
          this.#matchesDay(firstRoute, day) &&
          this.#matchesDay(secondRoute, day) &&
          layoverMins >= minTransferTime &&
          this.#isLayoverAcceptable(firstRoute.arriveTime, secondRoute.departTime)
        ) {
          results.push([firstRoute, secondRoute]);
        }
      }
    }
    return results;
  }

  twoStopSearch(from, to, day) {
    const results = [];
    const cleanedTo = this.#cleanString(to);
    const startList = this.#getStartList(from);

    for (const firstRoute of startList) {
      const firstMidCity = this.#cleanString(firstRoute.arriveCity);
      const connectingRoutes1 =
        this.#indexByDepart.get(firstMidCity) ||
        this.#routes.filter((r) => this.#cleanString(r.from) === firstMidCity);

      for (const secondRoute of connectingRoutes1) {
        if (!this.#matchesDay(firstRoute, day) || !this.#matchesDay(secondRoute, day))
          continue;

        const layover1 = this.#transferMinutes(firstRoute, secondRoute);
        if (layover1 < minTransferTime || !this.#isLayoverAcceptable(firstRoute.arriveTime, secondRoute.departTime))
          continue;

        const secondMidCity = this.#cleanString(secondRoute.arriveCity);
        const connectingRoutes2 =
          this.#indexByDepart.get(secondMidCity) ||
          this.#routes.filter((r) => this.#cleanString(r.from) === secondMidCity);

        for (const thirdRoute of connectingRoutes2) {
          const layover2 = this.#transferMinutes(secondRoute, thirdRoute);

          if (
            this.#cleanString(thirdRoute.arriveCity).includes(cleanedTo) &&
            this.#matchesDay(thirdRoute, day) &&
            layover2 >= minTransferTime &&
            this.#isLayoverAcceptable(secondRoute.arriveTime, thirdRoute.departTime)
          ) {
            results.push([firstRoute, secondRoute, thirdRoute]);
          }
        }
      }
    }
    return results;
  }

  search(from, to, day, sortBy = "duration") {
    let itins = this.directSearch(from, to, day).map((r) => this.#toItinerary([r]));
    if (!itins.length) itins.push(...this.oneStopSearch(from, to, day).map(segments => this.#toItinerary(segments)));
    if (!itins.length) itins.push(...this.twoStopSearch(from, to, day).map(segments => this.#toItinerary(segments)));

    if (sortBy === "duration") {
      itins.sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes);
    } else if (sortBy === "price") {
      itins.sort((a, b) => a.totalPrice.second - b.totalPrice.second);
    } else if (sortBy === "depart") {
      const dep = (it) => it.segments?.[0]?.departTime || "";
      itins.sort((a, b) => dep(a).localeCompare(dep(b)));
    }

    return itins;
  }
}

const routeSearch = new RouteSearch();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, csv: dataFile, routesLoaded: 0, dbRouteCount: db.countRoutes() });
});

app.get("/api/search", (req, res) => {
  const { from = "", to = "", day = "", sort = "duration" } = req.query;
  const itins = routeSearch.search(from, to, day, sort);
  res.json({ itineraries: itins });
});

app.get("/api/debug/echo", (req, res) => {
  res.json({
    received: req.query
  });
});

/**
 * BookingService class handles booking-related operations
 */
class BookingService {
  #dbConnection;

  constructor() {
    this.#dbConnection = db;
  }

  summarizeConnection(conn) {
    if (!conn || !conn.segments || !conn.segments.length) return "";
    const first = conn.segments[0];
    const last = conn.segments[conn.segments.length - 1];
    return `${first?.from || "?"} → ${last?.arriveCity || "?"} (${first?.departTime || "?"} - ${last?.arriveTime || "?"})`;
  }

  createBooking(connection, travellers) {
    if (!connection || !Array.isArray(connection.segments) || connection.segments.length === 0) {
      throw new Error("Missing or invalid connection.");
    }
    if (!Array.isArray(travellers) || travellers.length === 0) {
      throw new Error("At least one traveller required.");
    }

    // Add connection summary to the connection object
    connection.connectionSummary = this.summarizeConnection(connection);

    // Create trip in database
    const tripId = this.#dbConnection.createTrip(connection);

    // Insert trip segments
    this.#dbConnection.insertTripSegments(tripId, connection.segments, connection.transferTimes || []);

    // Create reservations and tickets for each traveller
    const reservations = travellers.map((t) => {
      const reservationId = this.#dbConnection.createReservation(tripId, {
        firstName: t.firstName?.toString().trim() || "",
        lastName: t.lastName?.toString().trim() || "",
        age: Number(t.age) || 0,
        idNumber: t.idNumber?.toString().trim() || ""
      });

      const ticketId = this.#dbConnection.createTicket(reservationId);

      return {
        firstName: t.firstName?.toString().trim() || "",
        lastName: t.lastName?.toString().trim() || "",
        age: Number(t.age) || 0,
        idNumber: t.idNumber?.toString().trim() || "",
        ticket: {
          ticketId
        }
      };
    });

    return { tripId, reservations };
  }

  getPassengerTrips(lastName, idNumber) {
    if (!lastName || !idNumber) {
      throw new Error("Missing lastName or idNumber.");
    }

    // Get trips from database
    const tripRows = this.#dbConnection.getTripsByPassenger(lastName, idNumber);

    // Get current date/time for comparison
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    const currentTrips = [];
    const pastTrips = [];

    for (const trip of tripRows) {
      const reservations = this.#dbConnection.getReservationsByTrip(trip.trip_id);
      const segments = this.#dbConnection.getTripSegments(trip.trip_id);

      // Get the departure time of the first segment
      const firstSegment = segments[0];
      let isPastTrip = false;

      if (firstSegment) {
        const [depHour, depMinute] = firstSegment.departTime.split(":").map(Number);
        const departTimeInMinutes = depHour * 60 + depMinute;
        isPastTrip = departTimeInMinutes < currentTimeInMinutes;
      }

      const tripData = {
        tripId: trip.trip_id,
        connectionSummary: trip.connection_summary,
        reservations: reservations.map(r => ({
          firstName: r.first_name,
          lastName: r.last_name,
          age: r.age,
          idNumber: r.id_number,
          ticket: {
            ticketId: r.ticket_id
          }
        }))
      };

      if (isPastTrip) {
        pastTrips.push(tripData);
      } else {
        currentTrips.push(tripData);
      }
    }

    return { currentTrips, pastTrips };
  }
}

const bookingService = new BookingService();

app.post("/api/book", (req, res) => {
  const { connection, travellers } = req.body || {};

  try {
    const { tripId, reservations } = bookingService.createBooking(connection, travellers);

    res.json({
      ok: true,
      tripId,
      reservationsCount: reservations.length,
      reservations
    });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(400).json({ error: err.message || "Failed to create booking." });
  }
});

app.get("/api/trips", (req, res) => {
  const lastNameQ = (req.query.lastName || "").toString().trim();
  const idNumberQ = (req.query.idNumber || "").toString().trim();

  try {
    const { currentTrips, pastTrips } = bookingService.getPassengerTrips(lastNameQ, idNumberQ);

    res.json({
      currentTrips,
      pastTrips,
      trips: [...currentTrips, ...pastTrips]
    });
  } catch (err) {
    console.error("Error fetching trips:", err);
    res.status(400).json({ error: err.message || "Failed to retrieve trips." });
  }
});

const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")));

/**
 * DataLoader class handles CSV loading and initialization
 */
class DataLoader {
  #csvProcessor;
  #routeSearch;

  constructor(csvProcessor, routeSearch) {
    this.#csvProcessor = csvProcessor;
    this.#routeSearch = routeSearch;
  }

  async loadCSV(filePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) return reject(new Error(`CSV not found at: ${filePath}`));
      const sep = this.#csvProcessor.detectSeparator(filePath);
      const rows = [];
      fs.createReadStream(filePath, "utf8")
        .pipe(csv({ separator: sep }))
        .on("data", (row) => rows.push(row))
        .on("end", () => resolve({ rows, sep }))
        .on("error", reject);
    });
  }

  async initialize(filePath) {
    const { rows, sep } = await this.loadCSV(filePath);
    console.log(`CSV read OK from ${filePath} (detected separator: ${JSON.stringify(sep)})`);
    
    const parsedRoutes = rows.map(r => this.#csvProcessor.normalizeRow(r)).filter(Boolean);
    console.log(`Parsed routes: ${parsedRoutes.length} / original rows: ${rows.length}`);

    // Initialize database
    db.initDatabase();

    // Check if routes already exist in database
    const existingCount = db.countRoutes();
    if (existingCount === 0) {
      console.log("Database is empty. Inserting routes...");
      db.insertRoutesBatch(parsedRoutes);
      console.log(`Inserted ${parsedRoutes.length} routes into database`);
    } else {
      console.log(`Database already contains ${existingCount} routes. Skipping insert.`);
    }

    // Load routes from database into memory for searching
    this.#routeSearch.loadRoutesFromDatabase();
  }
}

const dataLoader = new DataLoader(csvProcessor, routeSearch);

function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} in use. Set PORT env or change the fallback in server.js.`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });
}

dataLoader.initialize(dataFile)
  .then(() => {
    startServer();
  })
  .catch((err) => {
    console.error("Failed to load data:", err?.message || err);
    process.exit(1);
  });






  
  


