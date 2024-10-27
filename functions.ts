import {createCanvas, loadImage} from "https://deno.land/x/canvas@v1.4.2/mod.ts";
import {mastTileKeys, cityData, testData} from './lookups.ts';
import {xy, rawData, targ, targArr, resArr, resArrArr, retObj, reqStat} from "./types.ts";
import {mercator, genTileKey, rgbToId, makeUrl, validateBorder} from "./geo_functions.ts";
import {equals} from "https://deno.land/std/bytes/mod.ts";

const kv = await Deno.openKv();
const startTs: number = (new Date()).getTime() / 1000;

export async function handleMcRequest (request: Request, thisReq: reqStat): Promise<Response> {
    const inpData: JSON = await request.json();
    // Assert that the request payload is appropriate
    if (!Array.isArray(inpData))                                                       return new Response("Request is not array",   {status: 501});
    if (!inpData.every(x => typeof x === "object" && !Array.isArray(x) && x !== null)) return new Response("Invalid request data",   {status: 501});
    if (!inpData.every(e => e.id && e.lat && e.lon && Object.keys(e).length <= 4))     return new Response("Invalid request data",   {status: 501});
    if (!inpData.every(e => Math.abs(e.lat) <= 85.0511287798066))                      return new Response("Out of bounds latitude", {status: 501});
    // Assert that id is unique
    if (inpData.length > (new Set(inpData.map(l => l.id))).size)                       return new Response("Element ids not unique", {status: 501});
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
    let tileData: Uint8ClampedArray;
    const entry = await kv.get<Uint8ClampedArray>(["tile", tileKey, 0]); // Only need to check for the first slice existing
    if (entry.value) { // If available, read from cache
        tileData = await readTileKv(tileKey);
    } else {
        const url = makeUrl(tileKey);
        const cvs = createCanvas(256, 256);
        const ctx = cvs.getContext("2d");
        const image = await loadImage(url);
        ctx.drawImage(image, 0, 0);
        tileData = ctx.getImageData(0, 0, 256, 256).data;
        storeTileKv(tileKey, tileData);
    }
    return locations.map(loc => {
        const spl = (loc.y * 256 + loc.x) * 4; // Locate data
        const mcid = rgbToId(tileData.slice(spl, spl + 3)); // Read specified data & convert to id, no alpha
        const mcn = cityData[mcid] || ''; // Read name from lookup
        if (mcn    === '') return {"id": loc.id, "mc": mcn};
        if (loc.cc === '') return {"id": loc.id, "mc": mcn};
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

export async function countCache (): Promise<string> {
    const cachedTiles = await kv.list({prefix: ["tile"]});
    // May need to filter for those which dow have values
    return "Cached " + (Object.keys(cachedTiles).length / 8).toString() + " of " + mastTileKeys.length + " tiles";
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
    const updatedFiles = new Set<string>();
    for (const commit of payload.commits) {
        for (const file of commit.modified) {
            if (file.startsWith("tiles/") && file.endsWith(".png")) {
            const fileName = file.split("/").pop()!;
            updatedFiles.add(fileName);
            }
        }
    }
    // Remove updated files from cache
    for (const tileKey of updatedFiles) {
        for (let i = 0; i < 8; i++) kv.delete(["tile", tileKey, i]);
        console.log(`Cache cleared for updated tile: ${tileKey}`);
    }
    return new Response("Webhook processed", {status: 200});
}

// Deno kv values are limited to a length of 65536 bytes
function storeTileKv (tileKey: string, tileData: Uint8ClampedArray) {
    const sliceLen = 256 * 256 * 4 / 8;
    for (let i = 0; i < 8; i++) {
        const readPoint = i * 256 * 256 * 4 / 8;
        const sliceData = tileData.slice(readPoint, readPoint + sliceLen);
        kv.set(["tile", tileKey, i], sliceData);
    }
}

async function readTileKv (tileKey: string): Promise<Uint8ClampedArray> {
    const fullArray = new Uint8ClampedArray(256 * 256 * 4);
    const sliceLen = 256 * 256 * 4 / 8;
    for (let i = 0; i < 8; i++) {
        const sliceData = await kv.get<ArrayBuffer>(["tile", tileKey, i]);
        if (sliceData.value !== null) {
            const sliceArray = new Uint8ClampedArray(sliceData.value);
            fullArray.set(sliceArray, i * sliceLen);
        } else {
            console.log(`Data for tile slice${i} on ${tileKey} not found`);
        }
    }
    return fullArray;
}



// Function to verify the GitHub signature using HMAC SHA-256
const SECRET = Deno.env.get("auth") || "";
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
