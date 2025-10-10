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
