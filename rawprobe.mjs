
// What do the raw end fields actually contain for the 67 events ending at 02:00?
import { execFileSync } from "node:child_process";
const raw = JSON.parse(execFileSync("curl",["-s","https://pinkpages.indigokarasu.com/events.json"],{maxBuffer:1e8}).toString());
const ids = raw.events.filter(e=>e.endMinutes===120).map(e=>e.id).slice(0,6);
console.log("sample ids:", ids.join(","));
// fetch the source feed and look at their raw end fields
const src = execFileSync("curl",["-s","https://www.dothebay.com/events/"],{maxBuffer:1e8, encoding:"utf8"});
console.log("feed bytes:", src.length);
