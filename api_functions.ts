import {equals} from "jsr:@std/bytes";
import {createCanvas, loadImage} from "jsr:@gfx/canvas-wasm";
import {testData} from './lookups.ts';
import {geoPoint, rawInput, processedInput, baseResult, resultMap, requestStats, tileCache, rawCity, cities, changeLog, PendingDeletions} from "./types.ts";
import {mercator, genTileKey, validateBorder} from "./geo_functions.ts";
import {loadRemoteJSON, isValidTileKey, encodeTile, makeUrl, decodeTile, formatResult} from "./utils.ts";

const startTs: number = Date.now() / 1000;
const kv = await Deno.openKv();
// 512MB max memory is available on Deno deploy and kv only permits values up to 64KiB
// A Uint8ClampedArray size 256*256*4 is 2097152 bytes and there are 2370 tiles so far
// An uncompressed cache is therefore not possible, nor is storing them in the kv as is
// The tileCache data structure is MUCH more memory efficient, using just 4.54 MiB total in kv
// Data is expanded only when needed

const mastTileSet: Set<string> = await (async () => {
    const inp: string[] = await loadRemoteJSON("https://raw.githubusercontent.com/cafread/metrocity2024/main/res/mastTileKeys.json");
    return new Set(inp);
})();

const masterCities: cities = await (async () => {
    const inp: rawCity[] = await loadRemoteJSON("https://raw.githubusercontent.com/cafread/metrocity2024/main/res/2020cities15k_trimmed.json");
    return Object.fromEntries(inp.map(c => [c.i, {p: c.p, n: c.n, la: c.la, lo: c.lo}]));
})();

export async function handleMcRequest (request: Request, thisReq: requestStats): Promise<Response> {
    const reqLim = parseInt(Deno.env.get("reqLim") || "1000000", 10);
    try {
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
        const readPromises: Promise<baseResult[]>[] = [];
        for (const tileKey of Object.keys(toRead)) readPromises.push(readTile(tileKey, toRead[tileKey]));
        // Read and cache the tile data then calculate, format & return results
        const values: baseResult[][] = await Promise.all(readPromises);
        const result: resultMap = formatResult(values);
        thisReq.endTs = Date.now();
        console.log(thisReq);
        return new Response(JSON.stringify(result), {"status": 200, headers: {"content-type": "application/json"}});
    }
    catch (err: unknown) {
        console.error("Invalid mc_api request:", err instanceof Error ? err.message : String(err));
        return new Response("Invalid request data", {status: 400});
    }
}

async function readTile (tileKey: string, locations: processedInput[]): Promise<baseResult[]> {
    if (!mastTileSet.has(tileKey)) return locations.map(t => ({"id": t.id, "mc": ''}));
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
        updateTileChangeLog(tileKey);
    }
    const mcData = decodeTile(tileData);
    return locations.map(loc => {
        const cityId = mcData[loc.y * 256 + loc.x];
        const mcn = masterCities[cityId]?.n;
        if (!mcn || !loc.cc) return {id: loc.id, mc: mcn ?? ""};
        return validateBorder(loc.cc, mcn.slice(-2), {id: loc.id, mc: mcn});
    });
}

function prepData (rawData: rawInput[]): {[index: string]: processedInput[]} {
    // Project the lat long, calculate the tileKey
    // Return projected values grouped by tileKey
    const res: {[index: string]: processedInput[]} = {};
    for (const d of rawData) {
        const p: [number, number] = mercator({lat: d.lat, lon: d.lon});
        const tileKey: string = genTileKey(p);
        const x = Math.floor(p[0]) % 256;
        const y = Math.floor(p[1]) % 256;
        const cc: string = (d.cc || '').toUpperCase(); // cc is optional in request
        const thisTarg: processedInput = {id: d.id, x: x, y: y, cc: cc};
        if (res[tileKey]) {
            res[tileKey].push(thisTarg)
        } else {
            res[tileKey] = [thisTarg];
        }
    };
    return res;
}

export function status (): string {
    const upTim = Date.now() / 1000 - startTs;
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

export async function getChangeLog (thisReq: requestStats): Promise<Response> {
    // Retrieve the Deno KV change logs and return them
    const tileLog = await kv.get<changeLog>(["changelog", "tiles"], {consistency: "eventual"});
    const cityLog = await kv.get<changeLog>(["changelog", "cities"], {consistency: "eventual"});
    // Initialise the city change log, if it is currently empty
    if (!cityLog?.value) updateCityChangeLog(new Set());
    // Given the endpoint, returning a metro city name : id map as well is useful
    const nameMap: Record<number, string> = Object.fromEntries(Object.entries(masterCities).map(([id, info]) => [Number(id), info.n]));
    const res = {
        "tiles": tileLog?.value ?? {},
        "mcids": cityLog?.value ?? {},
        "names": nameMap
    };
    thisReq.endTs = Date.now();
    console.log(thisReq);
    return new Response(JSON.stringify(res), {"status": 200, headers: {"content-type": "application/json"}});
}

async function updateTileChangeLog (tileKey: string): Promise<void> {
    const newLog = Object.fromEntries([...mastTileSet].map(tileKey => [tileKey, 1746086400000])); // 2025-05-01 09:00:00.000
    newLog[tileKey] = Date.now();
    // Acquire a lock on the changelog to avoid concurrent writes and data loss
    const lockKey = ["lock", "changelog", "tiles"];
    const changelogKey = ["changelog", "tiles"];
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const gotLock = await acquireLock(lockKey, 1000); // 1 second TTL
        if (gotLock) {
            try {
                const kvLog = await kv.get<Record<string, number>>(changelogKey, {consistency: "strong"});
                if (kvLog.value) {
                    for (const [tk, ts] of Object.entries(kvLog.value as changeLog)) {
                        if (tk != tileKey) newLog[tk] = ts;
                    }
                }
                await kv.set(changelogKey, newLog);
                console.log(`Tile change log built with ${Object.keys(newLog).length} entries`);
                const unexpectedInLog = Object.keys(newLog).filter(k => !mastTileSet.has(k));
                if (unexpectedInLog.length > 0) console.warn(`Tiles in KV but not in mastTileSet: ${JSON.stringify(unexpectedInLog)}`);
                await releaseLock(lockKey);
                return;
            } catch (err) {
                console.error(`Failed to update tile changelog:`, err);
                await releaseLock(lockKey);
                return;
            }
        }
        // Lock not acquired: wait with jitter before retrying
        const delay = 500 * attempt + Math.random() * 1000;
        await new Promise(res => setTimeout(res, delay));
    }
    console.warn(`Failed to acquire lock on tile changelog after ${maxAttempts} attempts`);
}

async function updateCityChangeLog (metroCityIDsChanged: Set<number>): Promise<void> {
    const newLog = Object.fromEntries(Object.keys(masterCities).map((id) => [Number(id), 1746086400000])); // 2025-05-01 09:00:00.000
    for (const metroCityID of [...metroCityIDsChanged]) newLog[metroCityID] = Date.now();
    // Acquire a lock on the changelog to avoid concurrent writes and data loss
    const lockKey = ["lock", "changelog", "cities"];
    const changelogKey = ["changelog", "cities"];
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const gotLock = await acquireLock(lockKey, 1000); // 1 second TTL
        if (gotLock) {
            try {
                console.log(`Updating change log for ${metroCityIDsChanged.size} ${metroCityIDsChanged.size === 1 ? 'city' : 'cities'}: ${JSON.stringify([...metroCityIDsChanged])}`);
                // Read the existing values and apply them where we don't want to apply an update
                const kvLog = await kv.get<Record<string, number>>(changelogKey, {consistency: "strong"});
                if (kvLog.value) {
                    for (const [metroCityID, updateTS] of Object.entries(kvLog.value as changeLog)) {
                        if (!metroCityIDsChanged.has(Number(metroCityID))) newLog[metroCityID] = updateTS;
                    }
                }
                await kv.set(changelogKey, newLog);
                await releaseLock(lockKey);
                return;
            } catch (err) {
                console.error("Error writing city change log to Deno KV:", err instanceof Error ? err.message : String(err));
                await releaseLock(lockKey);
                return;
            }
        }
        // Lock not acquired — wait with jitter before retrying
        const delay = 500 * attempt + Math.random() * 1000;
        await new Promise((res) => setTimeout(res, delay));
    }
    console.warn(`Failed to acquire lock on city changelog after ${maxAttempts} attempts`);
}

// Helper function to handle incoming GitHub webhook payload
export async function handleGithubWebhook (req: Request): Promise<Response> {
    console.log("Potential tile update, checking for changes");
    const body = new Uint8Array(await req.arrayBuffer());
    if (!(await verifySignature(req, body))) {
        console.log("Invalid signature, request denied.");
        return new Response("Unauthorized", {status: 401});
    }
    console.log("Signature verified, proceeding");
    const payload = JSON.parse(new TextDecoder().decode(body));
    const updatedTileKeys = new Set<string>();
    const allModifiedFiles = new Set<string>();
    for (const commit of payload.commits) {
        for (const file of commit.modified) {
            allModifiedFiles.add(file);
        }
    }
    let diffText: string | null = null;
    if (allModifiedFiles.has("res/2020cities15k_trimmed.json") || allModifiedFiles.has("res/masTileKeys.json")) {
        console.log("Diff required, fetching...");
        const diffResponse = await fetch(payload.compare, {headers: {"Accept": "application/vnd.github.v3.diff"}});
        if (!diffResponse.ok) {
            console.error("Failed to fetch diff:", await diffResponse.text());
            return new Response("Failed to fetch diff", {status: 500});
        }
        diffText = await diffResponse.text();
    }
    let editedCityIds: Set<number> = new Set();
    // Collect updated tiles names from the payload
    for (const commit of payload.commits) {
        // Additions will run through when they are added to the kv, here we invalidate outdated cache and update the change logs
        for (const file of commit.modified) {
            if (file.startsWith("tiles/") && file.endsWith(".png")) {
                const tileKey = file.split("/").pop()!.replace(/\.png$/, "");
                if (isValidTileKey(tileKey)) {
                    updatedTileKeys.add(tileKey);
                    // Retrieve the affected metro city ids from the kv cache to update in change log
                    // This does not include the effects of extending a city to new tiles
                    // That is handled by updating the city changelog when a new tile is read from github and added to the kv
                    const entry = await kv.get<tileCache>(["tile", tileKey], {consistency: "eventual"});
                    if (entry.value) {
                        const cityIds: Set<number> = new Set(entry.value.idMap.slice(1)); // Exclude 0
                        editedCityIds = editedCityIds.union(cityIds);
                    }
                }
            } else if (file === "res/2020cities15k_trimmed.json" && diffText != null) { // Rarely changes
                for (const line of diffText.split("\n")) {
                    if (line.startsWith("+") || line.startsWith("-")) {
                        const trimmedLine = line.slice(1).replace(/,$/, "").trim(); // Remove "+" or "-" and trailing comma
                        try {
                            const parsedEntry = JSON.parse(trimmedLine);
                            const loc: geoPoint = {lat: parsedEntry.la, lon:parsedEntry.lo};
                            // Project the latitude-longitude pair and generate a tile key
                            const tileKey = genTileKey(mercator(loc));
                            if (isValidTileKey(tileKey)) updatedTileKeys.add(tileKey);
                        } catch (_err: unknown) {
                            console.error(`Error parsing diff line: ${line}`);
                        }
                    }
                }
            } else if (file === "res/masTileKeys.json" && diffText != null) { // Rarely changes
                for (const line of diffText.split("\n")) {
                    if (line.startsWith("+") || line.startsWith("-")) {
                        const tileKey = line.slice(1).replace(/,$/, "").trim(); // Remove "+" or "-" and trailing comma
                        if (isValidTileKey(tileKey)) updatedTileKeys.add(tileKey);
                    }
                }
            }
        }
        // Where a tile is removed, update the city change log for those affected
        // Updated tiles will have metro city change log applied when they are read
        for (const file of commit.removed) {
            if (file.startsWith("tiles/") && file.endsWith(".png")) {
                const tileKey = file.split("/").pop()!.replace(/\.png$/, "");
                if (isValidTileKey(tileKey)) {
                    updatedTileKeys.add(tileKey);
                    // Retrieve the affected metro city ids from the kv cache to update in change log
                    const entry = await kv.get<tileCache>(["tile", tileKey], {consistency: "eventual"});
                    if (entry.value) {
                        const cityIds: Set<number> = new Set(entry.value.idMap.slice(1)); // Exclude 0
                        editedCityIds = editedCityIds.union(cityIds);
                    }
                }
            }
        }
    }
    // Update the tile and city change logs
    if (updatedTileKeys.size > 0) {
        console.log(`Updating ${updatedTileKeys.size} ${updatedTileKeys.size === 1 ? 'tile' : 'tiles'}: ${JSON.stringify([...updatedTileKeys])}`);
        // Schedule cache deletion for updated files after a 10-minute delay
        // Ask Deno KV to expire the stored values in 10 minutes
        for (const tileKey of [...updatedTileKeys]) {
            const entry = await kv.get<tileCache>(["tile", tileKey], {consistency: "eventual"});
            if (entry.value) await kv.set(["tile", tileKey], entry.value, {expireIn: 10 * 60 * 1000});
        }
        // Not 100 % expiration will work consistently as kv is still not 'stable', so additionally use the kv to store deletion requests
        // The edge server cannot be assumed to still be online in ten minutes, use the KV to store the request
        const deletionRequest: PendingDeletions = {
            tileKeys: [...updatedTileKeys],
            notBefore: Date.now() + 10 * 60 * 1000,
            createdAt: Date.now(),
            reason: "Webhook push"
        };
        // As logically multiple commits could be queued, ensure we do not overwrite them, but distinguish them
        const deletionKey : string = payload.commits[0].id.slice(0, 10);
        await kv.set(["pendingDeletions", deletionKey], deletionRequest);
    }
    if (editedCityIds.size > 0) {
        console.log(`Calling update city change log for ${editedCityIds.size} cities`);
        updateCityChangeLog(editedCityIds);
    }
    // Immediate response, not delayed by cache clearing
    return new Response("Webhook processed", {status: 200});
}

export async function onStart () {
    // Check to see if there are any pending deletions which we are allowed to execute at this point in time
    await processPendingDeletions();
    // Check that the kv store has all the tiles
    await checkTilesInKV();
}

// Cache the requested tile data with a delay per tile
function buildCacheWithDelay (tileKeys: string[]) {
    let index = 0;
    const intervalId = setInterval(async () => {
        if (index >= tileKeys.length) {
            clearInterval(intervalId); // Stop once all tiles are processed
            console.log("All tiles have been processed, server fully ready");
            return;
        }
        const tileKey = tileKeys[index];
        try {
            await readTile(tileKey, []);
            console.log(`Processed tile: ${tileKey}`);
        } catch(err: unknown) {
            console.error(`Failed to process tile ${tileKey}:`, err instanceof Error ? err.message : String(err));
        }
        index++;
    }, 400); // Delay between calls
}

// Function to verify the GitHub signature using HMAC SHA-256
async function verifySignature (req: Request, body: Uint8Array): Promise<boolean> {
    const SECRET = Deno.env.get("auth") || "";
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

export async function processPendingDeletions (now: number = Date.now()): Promise<void> {
    const prefix = ["pendingDeletions"];
    const iter = kv.list<PendingDeletions>({prefix});
    console.log("Checked for pending deletions");
    for await (const entry of iter) {
        const commitHash = entry.key[1].toString();
        console.log("Processing pending deletion", commitHash);
        const deletion = entry.value;
        if (!deletion || deletion.notBefore > now) continue;
        const lockKey = ["lock", "pendingDeletions", commitHash];
        const gotLock = await acquireLock(lockKey);
        if (!gotLock) {
            console.log(`Skipping deletion for ${commitHash}, lock held`);
            continue;
        }
        try {
            console.log(`Processing tile deletions from commit ${commitHash}`);
            for (const tileKey of deletion.tileKeys) {
                await kv.delete(["tile", tileKey]);
                console.log(`Deleted tile ${tileKey}`);
            }
            await kv.delete(["pendingDeletions", commitHash]);
            console.log(`Removed deletion request for commit ${commitHash}`);
        } finally {
            await releaseLock(lockKey);
        }
    }
}

export async function checkTilesInKV (): Promise<void> {
    const cacheStatus = Object.fromEntries([...mastTileSet].map(k => [k, 0]));
    try {
        for await (const entry of kv.list({prefix: ["tile"]}, {consistency: "eventual"})) {
            const key = entry.key[1].toString();
            if (mastTileSet.has(key)) cacheStatus[key] = 1; // Mark present
        }
    } catch (err: unknown) {
        console.error("Error accessing Deno KV:", err instanceof Error ? err.message : String(err));
    }
    const uncachedTiles = Object.entries(cacheStatus)
        .filter(([_k, v]) => v === 0)
        .map(([k, _v]) => k);
    if (uncachedTiles.length > 0) {
        console.log('Uncached tiles found', uncachedTiles);
        buildCacheWithDelay(uncachedTiles);
    }
}

async function acquireLock (key: Deno.KvKey, ttl?: number): Promise<boolean> {
    ttl = ttl || 10 * 100; // 10s lock as a default
    const now = Date.now();
    const expires = now + ttl;
    const existing = await kv.get<number>(key);
    if (existing.value && existing.value > now) return false; // Lock is active
    const res = await kv.atomic() // Override stale or unclaimed lock
        .check(existing.versionstamp
            ? {key, versionstamp: existing.versionstamp}
            : {key, versionstamp: null})
        .set(key, expires, {expireIn: ttl})
        .commit();
    return res.ok;
}

async function releaseLock (key: Deno.KvKey): Promise<void> {
    await kv.delete(key);
}
