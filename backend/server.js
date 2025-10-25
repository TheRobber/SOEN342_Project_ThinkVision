import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const dataFile = path.join(__dirname, "data", "eu_rail_network.csv");

const PORT = process.env.PORT || 3001;

const minTransferTime = 10;

const cleanString = (segment) =>
  (segment ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const nonEmpty = (segment) => segment != null && String(segment).trim() !== "";

const dayNameToCode = new Map([
  ["mon","MON"], ["monday","MON"],
  ["tue","TUE"], ["tues","TUE"], ["tuesday","TUE"],
  ["wed","WED"], ["weds","WED"], ["wednesday","WED"],
  ["thu","THU"], ["thur","THU"], ["thurs","THU"], ["thursday","THU"],
  ["fri","FRI"], ["friday","FRI"],
  ["sat","SAT"], ["saturday","SAT"],
  ["sun","SUN"], ["sunday","SUN"],
]);

function expandDays(originalRow) {
  const segment = cleanString(originalRow);
  if (!nonEmpty(segment)) return [];
  if (segment.includes("daily") || segment === "all") {
    return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].slice();
  }

  const parts = segment.split(",").map(p => p.trim()).filter(Boolean);
  const result = [];

  function addDay(name) {
    const code = dayNameToCode.get(name) || dayNameToCode.get(name.slice(0,3));
    if (code && !result.includes(code)) result.push(code);
  }

  for (const p of parts) {
    if (p.includes("-")) {
      const [a, b] = p.split("-").map(x => x.trim());
      if (!a || !b) continue;

      const daysArr = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
      const start = daysArr.indexOf(dayNameToCode.get(a) || dayNameToCode.get(a.slice(0,3)));
      const end   = daysArr.indexOf(dayNameToCode.get(b) || dayNameToCode.get(b.slice(0,3)));

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

function detectSeparator(filePath) {
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

function normalizeHeaders(row) {
  const cleaned = {};
  for (const [key,value] of Object.entries(row)) cleaned[cleanString(key)] = value;

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

function normalizeRow(originalRow) {
  const normalizedRow = normalizeHeaders(originalRow);

  const row = {
    routeId: normalizedRow["route_id"]?.toString().trim(),
    from: normalizedRow["depart_city"]?.toString().trim(),
    arriveCity: normalizedRow["arrive_city"]?.toString().trim(),
    departTime: normalizedRow["depart_time"]?.toString().trim(),
    arriveTime: normalizedRow["arrive_time"]?.toString().trim(),
    trainType: normalizedRow["train_type"]?.toString().trim(),
    days: expandDays(normalizedRow["days"]),
    price: {
      first: Number(normalizedRow["first_class_eur"]) || 0,
      second: Number(normalizedRow["second_class_eur"]) || 0,
    },
  };

  if (!nonEmpty(row.from) || !nonEmpty(row.arriveCity)) return null;
  if (!nonEmpty(row.departTime) || !nonEmpty(row.arriveTime)) return null;

  return row;
}

let routes = [];
let indexByDepart = new Map();

function buildIndex() {
  indexByDepart = new Map();
  for (const r of routes) {
    const key = cleanString(r.from);
    if (!indexByDepart.has(key)) indexByDepart.set(key, []);
    indexByDepart.get(key).push(r);
  }
}

function timeToMinutes(time) {
  const [hours, minutes] = (time || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function segmentDurationMinutes(segment) {
  const departure = timeToMinutes(segment.departTime);
  const arrival = timeToMinutes(segment.arriveTime);
  return arrival >= departure
    ? arrival - departure
    : arrival + 24 * 60 - departure;
}

function transferMinutes(prev, next) {
  const arrival = timeToMinutes(prev.arriveTime);
  const departure = timeToMinutes(next.departTime);
  const diff = departure - arrival;
  return diff >= 0 ? diff : diff + 24 * 60;
}

function sumPrice(segments) {
  return segments.reduce(
    (total, s) => ({
      first: total.first + (s.price.first || 0),
      second: total.second + (s.price.second || 0),
    }),
    { first: 0, second: 0 }
  );
}

function toItinerary(segments) {
  const transfers = [];
  let duration = 0;
  for (let i = 0; i < segments.length; i++) {
    duration += segmentDurationMinutes(segments[i]);
    if (i < segments.length - 1) {
      transfers.push(transferMinutes(segments[i], segments[i + 1]));
    }
  }
  duration += transfers.reduce((a, b) => a + b, 0);
  return {
    id: segments.map((s) => s.routeId).join("+"),
    totalDurationMinutes: duration,
    totalPrice: sumPrice(segments),
    transferTimes: transfers,
    segments,
  };
}

function matchesDay(segment, day) {
  return !nonEmpty(day) || segment.days.includes(day.toUpperCase());
}

function getStartList(from) {
  const cleanedCity = cleanString(from);
  if (!cleanedCity) return [];
  const exact = indexByDepart.get(cleanedCity) || [];
  if (exact.length) return exact;
  return routes.filter(
    (r) => cleanString(r.from).includes(cleanedCity)
  );
}

function directSearch(from, to, day) {
  const startList = getStartList(from);
  const cleanedTo = cleanString(to);
  return startList.filter(
    (r) =>
      cleanString(r.arriveCity).includes(cleanedTo) &&
      matchesDay(r, day)
  );
}

function oneStopSearch(from, to, day) {
  const results = [];
  const cleanedTo = cleanString(to);
  const startList = getStartList(from);

  for (const firstRoute of startList) {
    const midCity = cleanString(firstRoute.arriveCity);
    {
    }
    const options =
      indexByDepart.get(midCity) ||
      routes.filter((r) => cleanString(r.from) === midCity);

    for (const secondRoute of options) {
      if (
        cleanString(secondRoute.arriveCity).includes(cleanedTo) &&
        matchesDay(firstRoute, day) &&
        matchesDay(secondRoute, day) &&
        transferMinutes(firstRoute, secondRoute) >= minTransferTime
      ) {
        results.push([firstRoute, secondRoute]);
      }
    }
  }
  return results;
}

function twoStopSearch(from, to, day) {
  const results = [];
  const cleanedTo = cleanString(to);
  const startList = getStartList(from);

  for (const firstRoute of startList) {
    const firstMidCity = cleanString(firstRoute.arriveCity);
    const connectingRoutes1 =
      indexByDepart.get(firstMidCity) ||
      routes.filter((r) => cleanString(r.from) === firstMidCity);

    for (const secondRoute of connectingRoutes1) {
      if (!matchesDay(firstRoute, day) || !matchesDay(secondRoute, day))
        continue;
      if (transferMinutes(firstRoute, secondRoute) < minTransferTime)
        continue;

      const secondMidCity = cleanString(secondRoute.arriveCity);
      const connectingRoutes2 =
        indexByDepart.get(secondMidCity) ||
        routes.filter((r) => cleanString(r.from) === secondMidCity);

      for (const thirdRoute of connectingRoutes2) {
        if (
          cleanString(thirdRoute.arriveCity).includes(cleanedTo) &&
          matchesDay(thirdRoute, day) &&
          transferMinutes(secondRoute, thirdRoute) >= minTransferTime
        ) {
          results.push([firstRoute, secondRoute, thirdRoute]);
        }
      }
    }
  }
  return results;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, csv: dataFile, routesLoaded: routes.length });
});

app.get("/api/search", (req, res) => {
  const { from = "", to = "", day = "", sort = "duration" } = req.query;

  let itins = directSearch(from, to, day).map((r) => toItinerary([r]));
  if (!itins.length) itins.push(...oneStopSearch(from, to, day).map(toItinerary));
  if (!itins.length) itins.push(...twoStopSearch(from, to, day).map(toItinerary));

  if (sort === "duration") {
    itins.sort((a, b) => a.totalDurationMinutes - b.totalDurationMinutes);
  } else if (sort === "price") {
    itins.sort((a, b) => a.totalPrice.second - b.totalPrice.second);
  } else if (sort === "depart") {
    const dep = (it) => it.segments?.[0]?.departTime || "";
    itins.sort((a, b) => dep(a).localeCompare(dep(b)));
  }

  res.json({ itineraries: itins });
});

app.get("/api/debug/echo", (req, res) => {
  res.json({
    received: req.query
  });
});

let tripsStore = [];
let tripCounter = 1;
let ticketCounter = 1;

function makeTripId() {
  const id = "TRIP-" + tripCounter.toString(36).toUpperCase();
  tripCounter += 1;
  return id;
}

function makeTicketId() {
  const id = ticketCounter;
  ticketCounter += 1;
  return id;
}

function summarizeConnection(conn) {
  if (!conn || !conn.segments || !conn.segments.length) return "";
  const first = conn.segments[0];
  const last = conn.segments[conn.segments.length - 1];
  return `${first?.from || "?"} → ${last?.arriveCity || "?"} (${first?.departTime || "?"} - ${last?.arriveTime || "?"})`;
}

app.post("/api/book", (req, res) => {
  const { connection, travellers } = req.body || {};

  if (!connection || !Array.isArray(connection.segments) || connection.segments.length === 0) {
    return res.status(400).json({ error: "Missing or invalid connection." });
  }
  if (!Array.isArray(travellers) || travellers.length === 0) {
    return res.status(400).json({ error: "At least one traveller required." });
  }

  const reservations = travellers.map((t) => {
    return {
      firstName: t.firstName?.toString().trim() || "",
      lastName: t.lastName?.toString().trim() || "",
      age: Number(t.age) || 0,
      idNumber: t.idNumber?.toString().trim() || "",
      ticket: {
        ticketId: makeTicketId()
      }
    };
  });

  const tripId = makeTripId();

  const trip = {
    tripId,
    createdAt: Date.now(),
    connection,
    connectionSummary: summarizeConnection(connection),
    reservations
  };

  tripsStore.push(trip);

  res.json({
    ok: true,
    tripId,
    reservationsCount: reservations.length,
    reservations
  });
});

app.get("/api/trips", (req, res) => {
  const lastNameQ = (req.query.lastName || "").toString().trim().toLowerCase();
  const idNumberQ = (req.query.idNumber || "").toString().trim().toLowerCase();

  if (!lastNameQ || !idNumberQ) {
    return res.status(400).json({ error: "Missing lastName or idNumber." });
    }

  const found = tripsStore.filter((trip) => {
    return trip.reservations?.some((r) => {
      return (
        r.lastName?.toLowerCase() === lastNameQ &&
        r.idNumber?.toLowerCase() === idNumberQ
      );
    });
  });

  res.json({
    trips: found.map((t) => ({
      tripId: t.tripId,
      connectionSummary: t.connectionSummary,
      reservations: t.reservations
    }))
  });
});

const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(FRONTEND_DIR, "index.html")));

function loadCSV(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return reject(new Error(`CSV not found at: ${filePath}`));
    const sep = detectSeparator(filePath);
    const rows = [];
    fs.createReadStream(filePath, "utf8")
      .pipe(csv({ separator: sep }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve({ rows, sep }))
      .on("error", reject);
  });
}

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

loadCSV(dataFile)
  .then(({ rows, sep }) => {
    console.log(`CSV read OK from ${dataFile} (detected separator: ${JSON.stringify(sep)})`);
    routes = rows.map(normalizeRow).filter(Boolean);
    console.log(`Parsed routes: ${routes.length} / original rows: ${rows.length}`);
    buildIndex();
    startServer();
  })
  .catch((err) => {
    console.error("Failed to load CSV:", err?.message || err);
    process.exit(1);
  });



  
  


