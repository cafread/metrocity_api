import {createCanvas, loadImage} from "https://deno.land/x/canvas@v1.4.2/mod.ts";
import {testData} from './lookups.ts';
import {xy, latLon, rawData, targ, targArr, resArr, resArrArr, retObj, reqStat, tileCache, cityDatum, changeLog} from "./types.ts";
import {mercator, genTileKey, rgbToId, makeUrl, validateBorder} from "./geo_functions.ts";
import {equals} from "https://deno.land/std/bytes/mod.ts";
import {encodeBase64, decodeBase64} from "jsr:@std/encoding/base64";
import {compress, decompress} from "./lzstring.ts";
import {loadRemoteJSON, isValidTileKey} from "./utils.ts";

const mastTileKeys: string[] = await loadRemoteJSON("https://raw.githubusercontent.com/cafread/metrocity2024/main/res/mastTileKeys.json");
const cityData: cityDatum[] = await loadRemoteJSON("https://raw.githubusercontent.com/cafread/metrocity2024/refs/heads/main/res/2020cities15k_trimmed.json");

const startTs: number = (new Date()).getTime() / 1000;
const kv = await Deno.openKv();
// 512MB max memory is available on Deno deploy and kv only permits values up to 64KiB
// A Uint8ClampedArray size 256*256*4 is 2097152 bytes and there are 2370 tiles so far
// An uncompressed cache is therefore not possible, nor is storing them in the kv as is
// The tileCache data structure is MUCH more memory efficient, using just 4.54 MiB total in kv
// Data is expanded only when needed

function encodeTile (tileData: Uint8ClampedArray): tileCache {
    const tempArr = [];
    const ids: number[] = [0]; // 0 = no metro city
    for (let i = 0; i < 256*256*4; i+=4) {
        const mcid = rgbToId(tileData.slice(i, i + 3));
        let _id = ids.indexOf(mcid);
        if (_id === -1) {
            _id = ids.length;
            ids.push(mcid);
        }
        tempArr.push(_id);
    }
    const datStr = compress(encodeBase64(new Uint8Array(tempArr)));
    return {idMap: ids, datStr: datStr};
}

function decodeTile (tileCache: tileCache): number[] {
    // Turn a tilecache data structure into a 256*256 long array of mcids
    const codedMcs: Uint8Array = decodeBase64(decompress(tileCache.datStr));
    return Array.from(codedMcs).map(i => tileCache.idMap[i]);
}

export async function handleMcRequest (request: Request, thisReq: reqStat): Promise<Response> {
    const inpData: JSON = await request.json();
    // Assert that the request payload is appropriate
    if (!Array.isArray(inpData))                                                                               return new Response("Request is not array",    {status: 400});
    if (!inpData.every(x => typeof x === "object" && !Array.isArray(x) && x !== null))                         return new Response("Invalid request data",    {status: 400});
    if (!inpData.every(e => e.id && e.lat !== undefined && e.lon !== undefined && Object.keys(e).length <= 4)) return new Response("Invalid request keys",    {status: 400});
    if (!inpData.every(e => Math.abs(e.lat) <= 90))                                                            return new Response("Out of bounds latitude",  {status: 422});
    if (!inpData.every(e => !(e.lat === 0 && e.lon === 0)))                                                    return new Response("Null island found",       {status: 422});
    if (inpData.length > reqLim)                                                                               return new Response(`Limit of ${reqLim} locs`, {status: 413});
    // Assert that id is unique
    if (inpData.length > (new Set(inpData.map(l => l.id))).size)                                               return new Response("Element ids not unique",  {status: 400});
    thisReq.reqCount = inpData.length;
    // If there are no requests passed, run test data
    const toRead = inpData.length > 0 ? prepData(inpData) : prepData(testData);
    // Wait for all results, as the read function is per tile
    const readPromises: Promise<resArr>[] = [];
    for (const tileKey of Object.keys(toRead)) readPromises.push(readTile(tileKey, toRead[tileKey]));
    // Read and cache the tile data then calculate, format & return results
    let result: retObj = {};
    await Promise.all(readPromises).then((values: resArrArr) => result = resFmt(values));
    thisReq.endTs = (new Date()).getTime();
    console.log(thisReq);
    return new Response(JSON.stringify(result), {"status": 200, headers: {"content-type": "application/json"}});
}

export async function readTile (tileKey: string, locations: targArr): Promise<resArr> {
    if (mastTileKeys.indexOf(tileKey) === -1) return locations.map(t => ({"id": t.id, "mc": ''}));
    let tileData: tileCache;
    const entry = await kv.get<tileCache>(["tile", tileKey]); // Only need to check for the first slice existing
    if (entry.value) { // If available, read from cache
        tileData = entry.value;
    } else { // Retrieve from github remotely
        const url = makeUrl(tileKey);
        const cvs = createCanvas(256, 256);
        const ctx = cvs.getContext("2d");
        const image = await loadImage(url);
        ctx.drawImage(image, 0, 0);
        tileData = encodeTile(ctx.getImageData(0, 0, 256, 256).data);
        kv.set(["tile", tileKey], tileData);
        // Update the change log for each metro city id read - not zero though!
        updateCityChangeLog(new Set(tileData.idMap.slice(1)));
    }
    const mcData = decodeTile(tileData);
    return locations.map(loc => {
        const cityId = mcData[loc.y * 256 + loc.x];
        const cityDatum = cityData.find(c => c.i === cityId);
        const mcn = cityDatum?.n || "";
        if (mcn    === "") return {"id": loc.id, "mc": mcn};
        if (loc.cc === "") return {"id": loc.id, "mc": mcn};
        return validateBorder(loc.cc, mcn.slice(-2), {"id": loc.id, "mc": mcn});
    });
}

export function prepData (rawData: rawData): {[index: string]: targArr} {
    // Project the lat long, calculate the tileKey
    // Return projected values grouped by tileKey
    const res: {[index: string]: targArr} = {};
    for (const d of rawData) {
        const p: xy = mercator({lat: d.lat, lon: d.lon});
        const tileKey: string = genTileKey(p);
        const x = Math.floor(p[0]) % 256;
        const y = Math.floor(p[1]) % 256;
        const cc: string = (d.cc || '').toUpperCase(); // cc is optional in request
        const thisTarg: targ = {id: d.id, x: x, y: y, cc: cc};
        if (res[tileKey]) {
            res[tileKey].push(thisTarg)
        } else {
            res[tileKey] = [thisTarg];
        }
    };
    return res;
}

export function resFmt (arr: resArrArr): retObj {
    const result: retObj = {};
    for (const rA of arr) for (const r of rA) result[r.id] = r.mc;
    return result;
}

export function status (): string {
    const upTim = (new Date()).getTime() / 1000 - startTs;
    const upDay = (Math.floor((upTim / (60*60*24)))     ).toString();
    const upHrs = (Math.floor((upTim / (60*60   ))) % 24).toString();
    const upMin = (Math.floor((upTim / (60      ))) % 60).toString();
    const upSec = (Math.floor( upTim              ) % 60).toString();
    let msg  = 'Server has been up for ' + upDay + ' days, ';
        msg += upHrs + ' hours, ';
        msg += upMin + ' minutes, ';
        msg += upSec + ' seconds.';
    return msg;
}

export async function getChangeLog (): Promise<Response> {
    // Retrieve the Deno KV change log and return it
    const tileLog = await kv.get<changeLog>(["changelog", "tiles"]);
    const cityLog = await kv.get<changeLog>(["changelog", "cities"]);
    // Initialise the change log, if it is currently empty
    if (!tileLog?.value) updateTileChangeLog(new Set());
    if (!cityLog?.value) updateCityChangeLog(new Set());
    // Given the endpoint, returning a metro city name : id map as well is useful
    const nameMap = Object.fromEntries(cityData.map(city => [city.i, city.n]));
    const res = {
        "tiles": tileLog?.value ?? {},
        "mcids": cityLog?.value ?? {},
        "names": nameMap
    };
    return new Response(JSON.stringify(res), {"status": 200, headers: {"content-type": "application/json"}});
}

async function updateTileChangeLog (tileKeysChanged: Set<string>): Promise<boolean> {
    try {
        // Build a full version, handle first run, ensure 100 % coverage
        const newLog: changeLog = Object.fromEntries(mastTileKeys.map(tk => [tk, Date.now()]));
        const tkCache = await kv.get<changeLog>(["changelog", "tiles"]);
        if (tkCache.value) { // If the cache hit, handle updates
            // Apply previous updated timestamps, where the key is not in the updated list
            for (let [tileKey, updateTS] of Object.entries(tkCache.value)) {
                if (tileKeysChanged.has(tileKey) === false) {
                    newLog[tileKey] = updateTS;
                }
            }
        }
        // Cache the result
        await kv.set(["changelog", "tiles"], newLog);
        return true;
    }
    catch (err) {
        console.error("Error writing tile change log to Deno KV:", err instanceof Error ? err.message : String(err));
        return false;
    }
}

async function updateCityChangeLog(metroCityIDsChanged: Set<number>): Promise<boolean> {
    try {
        // Build a full version, handle first run, ensure 100 % coverage
        const newLog: changeLog = Object.fromEntries(cityData.map(c => [c.i, Date.now()]));
        const tkCache = await kv.get<changeLog>(["changelog", "cities"]);
        if (tkCache.value) { // If the cache hit, handle updates
            // Apply previous updated timestamps, where the key is not in the updated list
            for (let [mcid, updateTS] of Object.entries(tkCache.value)) {
                if (metroCityIDsChanged.has(+mcid) === false) {
                    newLog[mcid] = updateTS;
                }
            }
        }
        // Cache the result
        await kv.set(["changelog", "cities"], newLog);
        return true;
    }
    catch (err: unknown) {
        console.error("Error writing city change log to Deno KV:", err instanceof Error ? err.message : String(err));
        return false;
    }
}

// Helper function to handle incoming GitHub webhook payload
export async function handleGithubWebhook(req: Request): Promise<Response> {
    console.log("Potential tile update, checking for changes");
    const body = new Uint8Array(await req.arrayBuffer());
    if (!(await verifySignature(req, body))) {
        console.log("Invalid signature, request denied.");
        return new Response("Unauthorized", {status: 401});
    }
    console.log("Signature verified, proceeding");
    const payload = JSON.parse(new TextDecoder().decode(body));
    const updatedTileKeys = new Set<string>();
    // Collect updated tiles names from the payload
    for (const commit of payload.commits) {
        for (const file of commit.modified) {
            if (file.startsWith("tiles/") && file.endsWith(".png")) {
                const tileKey = file.split("/").pop()!.replace(/\.png$/, "");
                if (isValidTileKey(tileKey)) updatedTileKeys.add(tileKey);
            } else if (file === "res/2020cities15k_trimmed.json") {
                const diffPatch = commit.patch;
                const diffLines = diffPatch.split("\n");
                for (const line of diffLines) {
                    if (line.startsWith("+") || line.startsWith("-")) {
                        const trimmedLine = line.slice(1).replace(/,$/, "").trim(); // Remove "+" or "-" and any trailing comma
                        try {
                            const parsedEntry = JSON.parse(trimmedLine);
                            const loc: latLon = {lat: parsedEntry.la, lon:parsedEntry.lo};
                            // Project the latitude-longitude pair and generate a tile key
                            const tileKey = genTileKey(mercator(loc));
                            if (isValidTileKey(tileKey)) updatedTileKeys.add(tileKey);
                        } catch (_err) {
                            console.error(`Error parsing diff line: ${line}`);
                        }
                    }
                }
            } else if (file === "res/masTileKeys.json") {
                const diffPatch = commit.patch;
                const diffLines = diffPatch.split("\n");
                for (const line of diffLines) {
                    if (line.startsWith("+") || line.startsWith("-")) {
                        const trimmedLine = line.slice(1).replace(/,$/, "").trim(); // Remove "+" or "-"
                        const tileKey = trimmedLine;
                        if (isValidTileKey(tileKey)) updatedTileKeys.add(tileKey);
                    }
                }
            }
        }
        // Where a tile is removed, update the city change log for those affected
        // Updated tiles will have metro city change log applied when they are read
        let editedCityIds: Set<number> = new Set();
        for (const file of commit.removed) {
            if (file.startsWith("tiles/") && file.endsWith(".png")) {
                const tileKey = file.split("/").pop()!.replace(/\.png$/, "");
                if (isValidTileKey(tileKey)) {
                    updatedTileKeys.add(tileKey);
                    // Retrieve the affected metro city ids from the kv cache and update in change log
                    const entry = await kv.get<tileCache>(["tile", tileKey]);
                    if (entry.value) {
                        const cityIds: Set<number> = new Set(entry.value.idMap.slice(1)); // Exclude 0
                        editedCityIds = editedCityIds.union(cityIds);
                    }
                }
            }
        }
        updateCityChangeLog(editedCityIds);
    }
    // Update the tile change log
    updateTileChangeLog(updatedTileKeys);
    // Schedule cache deletion for updated files after a 10-minute delay
    for (const tileKey of updatedTileKeys) {
        setTimeout(async () => {
            await kv.delete(["tile", tileKey]);
            console.log(`Cache cleared for updated tile: ${tileKey}`);
        }, 10 * 60 * 1000);
    }
    // Immediate response, not delayed by cache clearing
    return new Response("Webhook processed", {status: 200});
}

export async function onStart () {
    // Check that the kv store has good coverage of the tileset
    const mastTileSet = new Set(mastTileKeys);
    const cacheStatus = Object.fromEntries(mastTileKeys.map(k => [k, 0]));
    try {
        for await (const entry of kv.list({prefix: ["tile"]})) {
            const key = entry.key[1].toString();
            if (mastTileSet.has(key)) cacheStatus[key] = 1; // Mark present
        }
    } catch (error) {
        console.error("Error accessing Deno KV:", error);
    }
    const uncachedTiles = Object.entries(cacheStatus)
        .filter(([_k, v]) => v === 0)
        .map(([k, _v]) => k);
    console.log(uncachedTiles);
    buildCacheWithDelay(uncachedTiles);
}

// Cache the requested tile data with a delay per tile
async function buildCacheWithDelay(tileKeys: string[]) {
    let index = 0;
    const intervalId = setInterval(async () => {
        if (index >= tileKeys.length) {
            clearInterval(intervalId); // Stop once all tiles are processed
            console.log("All tiles have been processed.");
            return;
        }
        const tileKey = tileKeys[index];
        try {
            await readTile(tileKey, []);
            console.log(`Processed tile: ${tileKey}`);
        } catch(error) {
            console.error(`Failed to process tile ${tileKey}:`, error);
        }
        index++;
    }, 400); // Delay between calls
}

// Function to verify the GitHub signature using HMAC SHA-256
const SECRET = Deno.env.get("auth") || "";
const reqLim = parseInt(Deno.env.get("reqLim") || "1000000", 10);
async function verifySignature(req: Request, body: Uint8Array): Promise<boolean> {
    const signature = req.headers.get("X-Hub-Signature-256");
    if (!signature || !SECRET) return false;
    // Generate the HMAC SHA-256 hash of the body using the secret
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(SECRET),
        {name: "HMAC", hash: "SHA-256"},
        false,
        ["sign"]
    );
    const hashBuffer = await crypto.subtle.sign("HMAC", key, body);
    const hashArray = new Uint8Array(hashBuffer);
    const digest = `sha256=${Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')}`;
    // Check if the calculated digest matches the GitHub signature
    return equals(new TextEncoder().encode(digest), new TextEncoder().encode(signature));
}
