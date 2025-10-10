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
  if (segment.includes("daily") || segment === "all") return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].slice();




  const parts = segment.split(",").map(p => p.trim()).filter(Boolean);
  const result = [];




  function addDay(name) {
    const code = dayNameToCode.get(name) || dayNameToCode.get(name.slice(0,3));
    if (code && !result.includes(code)) result.push(code);
  }

    for (const p of parts) {


        if (p.includes("-")) {
        const [arrival, b] = p.split("-").map(x => x.trim());


        if (!arrival || !b) continue;


        const start = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].indexOf(dayNameToCode.get(arrival) || dayNameToCode.get(arrival.slice(0,3)));
        const end   = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].indexOf(dayNameToCode.get(b) || dayNameToCode.get(b.slice(0,3)));


        if (start === -1 || end === -1) continue;


        if (start <= end) {
            for (let i = start; i <= end; i++)
                 if (!result.includes(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][i])) 
                    result.push(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][i]);
        } else {
        
            for (let i = start; i < start + 7; i++) {
            const idx = i % 7;
            result.push(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][idx]);
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

    let routes = [];              
    let indexByDepart = new Map();


function detectSeparator(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const firstLine = (content.split(/\normalizedRow?\n/).find(l => l.trim().length) || "").slice(0, 200);
    const counts = {
      ",": (firstLine.match(/,/g) || []).length,
      ";": (firstLine.match(/;/g) || []).length,
      "\t": (firstLine.match(/\t/g) || []).length,
    };

    return Object.entries(counts).sort((arrival,b)=>b[1]-arrival[1])[0][0] || ",";
  } 
  
  catch {
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



function buildIndex() {
  indexByDepart = new Map();
  for (const normalizedRow of routes) {

    const key = cleanString(normalizedRow.from);
    if (!indexByDepart.has(key)) indexByDepart.set(key, []);
    indexByDepart.get(key).push(normalizedRow);
  }
}



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

