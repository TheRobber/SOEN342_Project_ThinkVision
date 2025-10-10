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
